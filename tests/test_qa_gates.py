import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class QaGateTests(unittest.TestCase):
    def load_gate(self):
        path = ROOT / 'scripts' / 'qa_gates.py'
        self.assertTrue(path.is_file(), 'A fail-closed QA gate is required')
        spec = importlib.util.spec_from_file_location('qa_gates', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.qa_success

    def test_pass_requires_actual_webkit_pass(self):
        gate = self.load_gate()
        self.assertTrue(gate([{'view':'home','violations':[]},{'webkit_mobile':'pass','errors':[]}]))

    def test_blocked_or_missing_webkit_fails(self):
        gate = self.load_gate()
        for results in [[], [{'view':'home','violations':[]}], [{'webkit_mobile':'blocked-or-failed','reason':'missing browser'}]]:
            self.assertFalse(gate(results))

    def test_axe_and_js_errors_fail(self):
        gate = self.load_gate()
        self.assertFalse(gate([{'view':'home','violations':[{'id':'contrast'}]},{'webkit_mobile':'pass'}]))
        self.assertFalse(gate([{'webkit_mobile':'pass','errors':['runtime error']}]))

if __name__ == '__main__':
    unittest.main()
