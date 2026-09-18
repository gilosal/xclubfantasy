import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('history',pathlib.Path(__file__).resolve().parents[1]/'scripts/build_history.py')
h=importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

class HistoryTests(unittest.TestCase):
    def test_unplayed_weeks_excluded(self):
        self.assertEqual(h.played_weeks({'settings':{'last_scored_leg':1,'playoff_week_start':15}}),[1])
    def test_playoffs_excluded(self):
        self.assertEqual(len(h.played_weeks({'settings':{'last_scored_leg':17,'playoff_week_start':15}})),14)
    def test_regular_leader_not_champion(self):
        self.assertEqual(h.champion_rid({'status':'complete'},[{'p':3,'w':2},{'p':1,'w':7}]),7)
    def test_current_season_has_no_champion(self):
        self.assertIsNone(h.champion_rid({'status':'in_season'},[{'p':1,'w':7}]))
    def test_missing_bracket_no_guessed_champion(self):
        self.assertIsNone(h.champion_rid({'status':'complete'},[]))

if __name__=='__main__':unittest.main()
