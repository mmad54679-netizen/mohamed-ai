import unittest

from app import DEFAULT_NAMES, ROLES, choose_roles, mock_output


class TeamSelectionTests(unittest.TestCase):
    def test_arabic_mobile_app_selects_product_architecture_and_mobile(self):
        selected = choose_roles("أريد بناء تطبيق أندرويد بسيط للطلاب")
        self.assertEqual(selected[0], "leader")
        self.assertIn("product", selected)
        self.assertIn("architecture", selected)
        self.assertIn("mobile", selected)

    def test_security_qa_and_docs_are_available_specialties(self):
        selected = choose_roles("اختبار أمان التطبيق وتوثيق طريقة التشغيل")
        self.assertIn("qa", selected)
        self.assertIn("security", selected)
        self.assertIn("docs", selected)

    def test_selection_has_one_leader_and_at_most_five_specialists(self):
        selected = choose_roles("Build a mobile AI app with frontend, backend, tests, security, database, cloud and docs")
        self.assertEqual(selected[0], "leader")
        self.assertLessEqual(len(selected), 6)
        self.assertEqual(len(selected), len(set(selected)))
        self.assertTrue(set(selected[1:]).issubset(ROLES))

    def test_default_names_are_fictional_ai_personas_for_each_specialty(self):
        self.assertEqual(set(DEFAULT_NAMES), {"leader", *ROLES.keys()})
        output = mock_output("إنشاء تطبيق هاتف", choose_roles("إنشاء تطبيق هاتف"), DEFAULT_NAMES)
        self.assertIn("Planning team:", output)
        self.assertIn("آدم", output)


if __name__ == "__main__":
    unittest.main()
