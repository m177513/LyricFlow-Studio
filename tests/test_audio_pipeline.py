import sys
import unittest
import io
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from alignment import align_to_words
from audio_pipeline import atomic_download, choose_source, retry_missing, retry_windows


def fixture():
    source = [{'id': str(i), 'text': text} for i, text in enumerate(['intro', 'missing', 'ending'])]
    anchors, _ = align_to_words(source, [{'word': 'intro', 'start': 1, 'end': 2},
                                        {'word': 'ending', 'start': 8, 'end': 9}], 10000)
    return source, anchors


class RetryTests(unittest.TestCase):
    def test_original_is_selected_when_separation_loses_lines(self):
        source, anchors = fixture()
        better, _ = align_to_words(source, [{'word': 'intro', 'start': 1, 'end': 2},
                   {'word': 'missing', 'start': 4, 'end': 5}, {'word': 'ending', 'start': 8, 'end': 9}], 10000)
        self.assertEqual(choose_source(anchors, better), ('original', better))
        self.assertEqual(choose_source(better, anchors), ('vocals', better))

    def test_equal_coverage_prefers_fewer_review_flags_then_vocals_on_tie(self):
        _, anchors = fixture()
        weaker = [{**row, 'flags': ['partial_text']} for row in anchors]
        self.assertEqual(choose_source(weaker, anchors)[0], 'original')
        self.assertEqual(choose_source(anchors, anchors)[0], 'vocals')

    def test_short_model_download_is_not_published_or_reused(self):
        class Response(io.BytesIO):
            headers = {'Content-Length': '4'}
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'model.bin'
            with self.assertRaises(RuntimeError):
                atomic_download('test', target, opener=lambda *a, **kw: Response(b'ab'))
            self.assertFalse(target.exists())
            atomic_download('test', target, opener=lambda *a, **kw: Response(b'abcd'))
            self.assertEqual(target.read_bytes(), b'abcd')

    def test_vocal_miss_retries_original_and_keeps_good_rows(self):
        source, anchors = fixture()
        calls = []
        def transcribe(name, left, right):
            calls.append(name)
            return [] if name == 'vocals' else [{'word': 'missing', 'start': 4, 'end': 5}]
        result, evidence = retry_missing(source, anchors, 10000, transcribe, ['vocals', 'original'], lambda *a: None)
        self.assertEqual(calls, ['vocals', 'original'])
        self.assertEqual(result[0], anchors[0])
        self.assertEqual(result[2], anchors[2])
        self.assertEqual(result[1]['startMs'], 4000)
        self.assertEqual(result[1]['flags'], ['retry_recovered'])
        self.assertEqual(evidence[-1]['acceptedIds'], ['1'])

    def test_no_independent_asr_keeps_null(self):
        source, anchors = fixture()
        result, _ = retry_missing(source, anchors, 10000, lambda *a: [], ['vocals', 'original'], lambda *a: None)
        self.assertIsNone(result[1]['startMs'])

    def test_narrow_crop_recovers_phrase_omitted_by_broad_asr(self):
        source, anchors = fixture()
        anchors[2]['startMs'], anchors[2]['endMs'] = 35000, 36000
        calls = []
        def transcribe(name, left, right):
            calls.append((left, right))
            return [{'word':'missing', 'start':25, 'end':27}] if right-left == 20000 and left<=25000 and right>=27000 else []
        result, evidence = retry_missing(source, anchors, 40000, transcribe, ['vocals'], lambda *a:None)
        self.assertEqual(result[1]['startMs'],25000)
        self.assertEqual(result[1]['flags'],['retry_recovered'])
        self.assertEqual(result[0],anchors[0])
        self.assertEqual(result[2],anchors[2])
        self.assertTrue(evidence[-1]['narrow'])
        self.assertLessEqual(len(calls),4)

    def test_empty_narrow_crops_do_not_create_timing(self):
        source, anchors = fixture()
        anchors[2]['startMs'], anchors[2]['endMs'] = 35000,36000
        result, evidence = retry_missing(source,anchors,40000,lambda *a:[],['vocals','original'],lambda *a:None)
        self.assertIsNone(result[1]['startMs'])
        self.assertLessEqual(len(evidence),8)

    def test_same_text_outside_neighbour_bounds_cannot_be_recovered(self):
        source, anchors = fixture()
        result, _ = retry_missing(source, anchors, 10000,
             lambda *a: [{'word': 'missing', 'start': 8.1, 'end': 8.8}], ['vocals'], lambda *a: None)
        self.assertIsNone(result[1]['startMs'])

    def test_weak_partial_candidate_stays_unresolved(self):
        source, anchors = fixture()
        result, _ = retry_missing(source, anchors, 10000,
             lambda *a: [{'word': 'miss', 'start': 4, 'end': 5}], ['vocals'], lambda *a: None)
        self.assertIsNone(result[1]['startMs'])

    def test_leading_and_trailing_missing_intervals(self):
        _, anchors = fixture()
        leading = retry_windows(anchors[1:], 10000)[0]
        trailing = retry_windows(anchors[:2], 10000)[0]
        self.assertEqual(leading['low'], 0)
        self.assertEqual(trailing['high'], 10000)

    def test_recovered_vocals_does_not_request_original(self):
        source, anchors = fixture()
        calls = []
        def transcribe(name, *_):
            calls.append(name)
            return [{'word': 'missing', 'start': 3, 'end': 4}]
        retry_missing(source, anchors, 10000, transcribe, ['vocals', 'original'], lambda *a: None)
        self.assertEqual(calls, ['vocals'])

    def test_long_missing_run_is_not_silently_skipped(self):
        _, anchors = fixture()
        anchors[0]['startMs'] = anchors[0]['endMs'] = None
        anchors[0]['flags'] = ['unmatched']
        anchors[2]['startMs'], anchors[2]['endMs'] = 180000, 181000
        self.assertEqual(retry_windows(anchors, 190000)[0]['high'], 180000)


if __name__ == '__main__':
    unittest.main()
