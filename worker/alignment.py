"""Occurrence-aware line matching. No fabricated time interpolation."""
from __future__ import annotations

from difflib import SequenceMatcher
import math
import re
import unicodedata
from typing import Any


MAX_SPAN_WORDS = 28
MAX_INTERNAL_GAP_SECONDS = 8
MIN_COVERAGE = 0.55
MIN_F1 = 0.48
# ASR spelling/spacing variation is common in sung Korean. Only lower-support
# matches remain review candidates; the numeric coverage is still retained.
PARTIAL_REVIEW_COVERAGE = 0.75
TARGET_GAP_PENALTY = 0.008
UNMATCHED_LINE_PENALTY = -0.22


def normalize(text: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold() if c.isalnum())


def _english_number(n: int) -> str:
    small = ('zero one two three four five six seven eight nine ten eleven twelve '
             'thirteen fourteen fifteen sixteen seventeen eighteen nineteen').split()
    tens = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split()
    if n < 20:
        return small[n]
    if n < 100:
        return tens[n // 10] + (small[n % 10] if n % 10 else '')
    if n < 1000:
        return small[n // 100] + 'hundred' + (_english_number(n % 100) if n % 100 else '')
    return small[n // 1000] + 'thousand' + (_english_number(n % 1000) if n % 1000 else '')


def _matching_token(text: str, source: str) -> str:
    """Expand ASR digits only when that exact English form occurs in the source.

    This changes comparison text only, never lyrics or word timestamps.
    Keep literal digits when the source itself uses them.
    """
    def expand(match):
        digits = match.group()
        if len(digits) > 4 or (len(digits) > 1 and digits.startswith('0')) or digits in source:
            return digits
        n = int(digits)
        forms = [_english_number(n)]
        if 1000 <= n <= 2099 and n % 100 >= 10:
            forms.append(_english_number(n // 100) + _english_number(n % 100))
        return next((form for form in forms if form in source), digits)
    return normalize(re.sub(r'\b[0-9]+\b', expand, unicodedata.normalize('NFKC', text)))


def _candidate(part: str, target_parts: list[str], start: int, end: int) -> dict[str, Any] | None:
    """Score one contiguous ASR-word span for one source line."""
    target = ''.join(target_parts[start:end])
    if not part or not target:
        return None
    blocks = SequenceMatcher(None, part, target, autojunk=False).get_matching_blocks()
    matched = sum(block.size for block in blocks[:-1])
    coverage = matched / len(part)
    precision = matched / len(target)
    f1 = 2 * coverage * precision / (coverage + precision) if coverage + precision else 0.0
    if coverage < MIN_COVERAGE or f1 < MIN_F1:
        return None
    # Recall matters slightly more than precision because Whisper can merge
    # adjacent words, but the precision term prevents swallowing the next line.
    score = 0.76 * f1 + 0.24 * coverage - 0.002 * max(0, end - start - 1)
    return {
        'score': score,
        'coverage': coverage,
        'precision': precision,
        'start': start,
        'end': end,
    }


def _ordered_candidates(lines: list[dict[str, Any]], valid_words: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    """Choose non-overlapping line spans with a monotonic dynamic program.

    The previous implementation ran one character LCS over the complete song.
    That makes repeated hooks compete with each other and can select a later
    occurrence, even when the intervening verse is present in ASR. This DP
    scores bounded local spans while preserving both source-line and ASR order.
    """
    source_parts = [normalize(line['text']) for line in lines]
    target_parts = [normalize(str(word.get('word', word.get('text', '')))) for word in valid_words]
    target_count = len(target_parts)
    negative = float('-inf')
    scores = [0.0] + [negative] * target_count
    back_rows: list[list[tuple[Any, ...] | None]] = []

    for part in source_parts:
        target_parts = [_matching_token(str(w.get('word', w.get('text', ''))), part) for w in valid_words]
        next_scores = [negative] * (target_count + 1)
        back: list[tuple[Any, ...] | None] = [None] * (target_count + 1)

        # A prefix best allows extra ASR words (ad-libs, hallucinations, or
        # words from a missing source line) to be skipped with a small cost.
        best_start_score = negative
        best_cursor: int | None = None
        for start in range(target_count + 1):
            gap_score = best_start_score - TARGET_GAP_PENALTY if best_cursor is not None else negative
            if scores[start] > gap_score:
                best_start_score = scores[start]
                best_cursor = start
            elif best_cursor is not None:
                best_start_score = gap_score

            unmatched_score = scores[start] + UNMATCHED_LINE_PENALTY
            if unmatched_score > next_scores[start]:
                next_scores[start] = unmatched_score
                back[start] = ('unmatched', start)
            if best_cursor is None:
                continue

            for end in range(start + 1, min(target_count, start + MAX_SPAN_WORDS) + 1):
                if end > start + 1 and valid_words[end - 1]['start'] - valid_words[end - 2]['end'] > MAX_INTERNAL_GAP_SECONDS:
                    break
                candidate = _candidate(part, target_parts, start, end)
                if candidate is None:
                    continue
                candidate_score = best_start_score + candidate['score']
                if candidate_score > next_scores[end]:
                    next_scores[end] = candidate_score
                    back[end] = ('matched', best_cursor, candidate)

        scores = next_scores
        back_rows.append(back)

    cursor = max(range(target_count + 1), key=lambda index: scores[index], default=0)
    result: list[dict[str, Any] | None] = [None] * len(lines)
    for index in range(len(lines) - 1, -1, -1):
        choice = back_rows[index][cursor]
        if choice is None:
            continue
        if choice[0] == 'unmatched':
            cursor = choice[1]
        else:
            result[index] = choice[2]
            cursor = choice[1]
    return result


def align_to_words(lines: list[dict[str, Any]], words: list[dict[str, Any]], duration_ms: int,
                   origin: str = 'asr-anchor') -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Map ordered source lines to ordered whole-word ASR intervals."""
    valid_words: list[dict[str, Any]] = []
    for word in words:
        start, end = word.get('start'), word.get('end')
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            continue
        token = normalize(str(word.get('word', word.get('text', ''))))
        if not token:
            continue
        mapped = {**word, 'index': len(valid_words)}
        valid_words.append(mapped)
    source_length = sum(len(normalize(line['text'])) for line in lines)
    target_length = sum(len(normalize(str(word.get('word', word.get('text', ''))))) for word in valid_words)
    if source_length > 40000 or target_length > 120000:
        raise ValueError('정렬 입력이 너무 깁니다. 곡을 나누어 처리해 주세요.')
    candidates = _ordered_candidates(lines, valid_words)
    result: list[dict[str, Any]] = []
    consumed = set()
    for line, candidate in zip(lines, candidates):
        flags: list[str] = []
        coverage = round(candidate['coverage'], 4) if candidate else 0.0
        start_ms = end_ms = None
        if candidate:
            selected = valid_words[candidate['start']:candidate['end']]
            start_ms = max(0, round(min(word['start'] for word in selected) * 1000))
            end_ms = min(duration_ms, round(max(word['end'] for word in selected) * 1000))
            if end_ms <= start_ms:
                start_ms = end_ms = None
            else:
                consumed.update(word['index'] for word in selected)
        if start_ms is None:
            flags.append('unmatched')
        elif coverage < PARTIAL_REVIEW_COVERAGE or candidate['precision'] < PARTIAL_REVIEW_COVERAGE:
            flags.append('partial_text')
        if start_ms is not None and end_ms - start_ms > 14000:
            flags.append('long')
        if start_ms is not None and end_ms - start_ms < 200:
            flags.append('short')
        result.append({
            'id': line['id'], 'text': line['text'], 'startMs': start_ms, 'endMs': end_ms,
            'timestampMs': start_ms, 'confidence': None, 'coverage': round(coverage, 4),
            'origin': origin if start_ms is not None else 'unmatched', 'flags': flags,
        })
    unmatched_words = [{k: v for k, v in w.items() if k != 'index'} for w in valid_words if w['index'] not in consumed]
    matched_characters = sum(round(candidate['coverage'] * len(normalize(line['text']))) for line, candidate in zip(lines, candidates) if candidate)
    return result, {'unmatchedAsrWords': unmatched_words, 'matchedCharacters': matched_characters, 'sourceCharacters': source_length}


def choose_refined(anchors: list[dict[str, Any]], refined: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Forced alignment cannot prove that supplied lyrics were actually sung."""
    by_id = {line['id']: line for line in refined}
    result = []
    for anchor in anchors:
        candidate = by_id.get(anchor['id'])
        if not candidate or candidate['startMs'] is None:
            result.append(anchor)
            continue
        row = dict(candidate)
        row['flags'] = list(dict.fromkeys(candidate['flags'] + anchor['flags']))
        row['coverage'] = anchor['coverage']  # lexical support comes from independent ASR only
        if anchor['startMs'] is None:
            # Do not force absent source lines into an instrumental break.
            row['startMs'] = row['endMs'] = row['timestampMs'] = None
            row['origin'] = 'unmatched'
            row['flags'] = list(dict.fromkeys(row['flags'] + ['unmatched', 'forced_without_asr']))
        elif abs(candidate['startMs'] - anchor['startMs']) > 2500 or abs(candidate['endMs'] - anchor['endMs']) > 2500:
            row['flags'].append('alignment_disagrees')
        result.append(row)
    return result
