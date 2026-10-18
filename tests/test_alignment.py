import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from alignment import align_to_words, choose_refined, normalize


def lines(*texts):
    return [{'id': str(i), 'text': t} for i, t in enumerate(texts)]


def word(text, start, end):
    return {'word': text, 'start': start, 'end': end}


class AlignmentTests(unittest.TestCase):
    def test_asr_digits_match_spoken_year_without_rewriting_lyrics(self):
        text = 'Nineteen ninety-nine is the number'
        out, _ = align_to_words(lines(text), [word('1999',40.96,42.4), word('is',42.4,43.54), word('the',43.54,43.92), word('number',43.92,44.4)], 60000)
        self.assertEqual((out[0]['startMs'], out[0]['endMs']), (40960,44400))
        self.assertEqual(out[0]['coverage'], 1)
        self.assertEqual(out[0]['text'], text)

    def test_asr_digits_match_hyphenated_number(self):
        out, _ = align_to_words(lines('Room Thirty-Two'), [word('Room',1,2),word('32',2,3)], 10000)
        self.assertEqual(out[0]['coverage'], 1)
        self.assertEqual(out[0]['endMs'], 3000)

    def test_one_candidate_cannot_swallow_instrumental_break(self):
        out, _ = align_to_words(lines('alpha beta gamma'), [word('alpha',1,2),word('beta',60,61),word('gamma',61,62)], 70000)
        self.assertEqual(out[0]['startMs'],60000)
        self.assertEqual(out[0]['endMs'],62000)
        self.assertIn('partial_text', out[0]['flags'])

    def test_mixed_language_normalization(self):
        self.assertEqual(normalize('ＡＢＣ, 한글! Yeah'), 'abc한글yeah')

    def test_line_text_is_not_rewritten(self):
        source = lines('Hello, 한글!')
        out, _ = align_to_words(source, [word('hello', 1, 2), word('한글', 2, 3)], 10000)
        self.assertEqual(out[0]['text'], 'Hello, 한글!')
        self.assertEqual((out[0]['startMs'], out[0]['endMs']), (1000, 3000))
        self.assertIsNone(out[0]['confidence'])

    def test_repeated_chorus_keeps_occurrence_order_without_extra_warning(self):
        out, _ = align_to_words(lines('후렴', '중간', '후렴'), [word('후렴',1,2),word('중간',4,5),word('후렴',8,9)], 10000)
        self.assertEqual([x['startMs'] for x in out], [1000,4000,8000])
        self.assertTrue(all('repeat_check' not in x['flags'] for x in out))

    def test_repeated_hook_does_not_steal_a_later_occurrence(self):
        source = lines(
            '도입 문장',
            '같은 후렴',
            '중간 문장 하나',
            '중간 문장 둘',
            '같은 후렴',
        )
        words = [
            word('도입', 1, 1.5), word('문장', 1.5, 2),
            word('같은', 3, 3.5), word('후렴', 3.5, 4),
            word('중간', 5, 5.5), word('문장', 5.5, 6), word('하나', 6, 6.5),
            word('중간', 7, 7.5), word('문장', 7.5, 8), word('둘', 8, 8.5),
            word('같은', 10, 10.5), word('후렴', 10.5, 11),
        ]
        out, _ = align_to_words(source, words, 20000)
        self.assertEqual([x['startMs'] for x in out], [1000, 3000, 5000, 7000, 10000])
        self.assertEqual([x['endMs'] for x in out], [2000, 4000, 6500, 8500, 11000])
        self.assertFalse(any('overlap' in x['flags'] for x in out))

    def test_missing_line_is_not_interpolated(self):
        out, _ = align_to_words(lines('AAA','ZZZZZ','BBB'), [word('AAA',1,2),word('BBB',8,9)], 10000)
        self.assertIsNone(out[1]['startMs'])
        self.assertIsNone(out[1]['endMs'])
        self.assertIn('unmatched',out[1]['flags'])

    def test_no_lyrics_are_placed_in_long_instrumental_gap(self):
        out, _ = align_to_words(lines('가나다','라마바'),[word('가나다',1,2),word('라마바',61,62)],70000)
        self.assertEqual(out[0]['endMs'],2000)
        self.assertEqual(out[1]['startMs'],61000)

    def test_extra_asr_words_are_preserved_as_evidence(self):
        _, evidence = align_to_words(lines('가나다'),[word('가나다',1,2),word('yeah',3,4)],10000)
        self.assertEqual(evidence['unmatchedAsrWords'][0]['word'],'yeah')

    def test_partial_match_is_flagged(self):
        out,_ = align_to_words(lines('abcdefghij'),[word('abcdef',1,2)],10000)
        self.assertIn('partial_text',out[0]['flags'])
        self.assertEqual(out[0]['coverage'],.6)

    def test_weak_coincidence_has_no_timing(self):
        out,_=align_to_words(lines('abcdefghij'),[word('abc',1,2)],10000)
        self.assertIsNone(out[0]['startMs'])

    def test_invalid_word_time_is_ignored(self):
        out,_=align_to_words(lines('hello'),[word('hello',float('nan'),3),word('hello',4,4)],10000)
        self.assertIsNone(out[0]['startMs'])

    def test_end_time_never_exceeds_audio_duration(self):
        out,_=align_to_words(lines('hello'),[word('hello',1,15)],10000)
        self.assertEqual(out[0]['endMs'],10000)

    def test_forcing_source_text_is_not_evidence_that_it_was_sung(self):
        anchors,_=align_to_words(lines('hello'),[],10000)
        proposed,_=align_to_words(lines('hello'),[word('hello',2,3)],10000,'stable-ts')
        out=choose_refined(anchors,proposed)
        self.assertIsNone(out[0]['startMs'])
        self.assertIn('forced_without_asr',out[0]['flags'])

    def test_disagreeing_alignment_is_flagged(self):
        a,_=align_to_words(lines('hello'),[word('hello',1,2)],20000)
        b,_=align_to_words(lines('hello'),[word('hello',8,9)],20000,'stable-ts')
        self.assertIn('alignment_disagrees',choose_refined(a,b)[0]['flags'])

    def test_empty_input_is_safe(self):
        out,evidence=align_to_words([],[],1000)
        self.assertEqual(out,[])
        self.assertEqual(evidence['sourceCharacters'],0)


if __name__ == '__main__':
    unittest.main()
