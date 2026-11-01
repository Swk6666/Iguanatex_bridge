import unittest
from unittest.mock import patch
from wps_support import OfficeBatch


class BatchStateTests(unittest.TestCase):
    def test_lifecycle_and_cancel_keep_counts(self):
        batch = OfficeBatch()
        task = batch.start({'total': 3})
        with self.assertRaisesRegex(ValueError, '正在进行'):
            batch.start({'total': 1})
        item = batch.update({'id': task['id'], 'current': 2, 'succeeded': 1, 'failed': 1,
                             'errors': ['第 2 张：无效']})
        self.assertEqual((item['succeeded'], item['failed']), (1, 1))
        self.assertTrue(batch.cancel()['cancel_requested'])
        done = batch.finish({'id': task['id'], 'succeeded': 1, 'failed': 1})
        self.assertEqual(done['status'], 'cancelled')
        self.assertEqual(done['total'] - done['succeeded'] - done['failed'] - done['skipped'], 1)
        with self.assertRaisesRegex(ValueError, '已结束'):
            batch.update({'id': task['id']})
        self.assertEqual(batch.start({'total': 1})['status'], 'running')

    def test_stale_worker_cannot_replace_new_status(self):
        batch = OfficeBatch()
        with patch('wps_support.time.monotonic', return_value=100):
            first = batch.start({'total': 2})
        with patch('wps_support.time.monotonic', return_value=251):
            self.assertEqual(batch.status()['status'], 'interrupted')
            second = batch.start({'total': 1})
            with self.assertRaisesRegex(ValueError, '已结束'):
                batch.update({'id': first['id'], 'succeeded': 1})
            self.assertNotEqual(first['id'], second['id'])

    def test_invalid_progress_and_identifiers_are_rejected(self):
        batch = OfficeBatch()
        with self.assertRaises(ValueError): batch.start({'total': 101})
        first = batch.start({'total': 1})
        for request in ({'id': first['id'], 'succeeded': 2}, {'id': first['id'], 'active_job': 'invalid'},
                        {'id': 'another', 'current': 1}):
            with self.assertRaises(ValueError): batch.update(request)


if __name__ == '__main__': unittest.main()
