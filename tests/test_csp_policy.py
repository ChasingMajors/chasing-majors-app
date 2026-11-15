import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('csp_policy', Path(__file__).resolve().parents[1] / 'scripts/csp-policy.py')
csp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(csp)

class PolicyTests(unittest.TestCase):
    def test_exact_raw_script_style_hashes_and_browser_newlines(self):
        html = '<!-- <script>ignored()</script> --><script>\r\nconst a = "&amp;";\r</script><style>a>b{color:red}</style>'
        result = csp.policy('index.html', html)
        self.assertEqual([b['hash'] for b in result['inline']], [csp.digest('\nconst a = "&amp;";\n'), csp.digest('a>b{color:red}')])
        self.assertNotIn("'unsafe-inline'", result['directives']['script-src'])

    def test_mutation_refreshes_hash_not_hand_maintained(self):
        first = csp.policy('index.html', '<script>one()</script>')
        second = csp.policy('index.html', '<script>two()</script>')
        self.assertNotEqual(first['inline'], second['inline'])
        self.assertNotEqual(first['value'], second['value'])

    def test_non_javascript_data_blocks_are_not_required_hashes(self):
        result = csp.policy('index.html', '<script type="application/ld+json">{"x":1}</script><script src="/a.js"></script>')
        self.assertEqual(result['inline'], [])
        self.assertNotIn("'" + csp.digest('{"x":1}') + "'", result['value'])
        for kind in ['application/json', 'text/plain', 'application/ld+json']:
            self.assertEqual(csp.policy('index.html', '<script type="'+kind+'">data</script>')['inline'], [])
        self.assertEqual(len(csp.policy('index.html', '<script type="module">void 0</script>')['inline']), 1)
        self.assertEqual(result['external'][0]['origin'], csp.ORIGIN)

    def test_unreviewed_and_ambiguous_constructs_fail_closed(self):
        for html in ['<script src="https://evil.example/a.js"></script>', '<script src=""></script>',
                     '<script>unfinished', '<script><!-- ambiguous --></script>', '<script><script></script>',
                     '<script/>', '<button onclick="x()">', '<a href="javascript:x()">', '<a href="java&#x09;script:x()">', '<iframe src="/">',
                     '<base href="/">', '<template><script>x()</script></template>', '<noscript>fallback</noscript>',
                     '<script src="/a.js">unexpected()</script>', '<script src="/a" src="/b"></script>',
                     '<meta http-equiv="Content-Security-Policy" content="default-src *">', '<style>\x00</style>']:
            with self.subTest(html=html), self.assertRaises(ValueError): csp.policy('index.html', html)

    def test_origin_profiles_remain_page_specific(self):
        home = csp.policy('index.html', '')['directives']
        vault = csp.policy('vault/index.html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">')['directives']
        self.assertNotIn('https://script.google.com', home['connect-src'])
        self.assertNotIn('https://api.chasingmajors.com', vault['connect-src'])
        self.assertIn('https://fonts.googleapis.com', vault['style-src'])
        self.assertNotIn('frame-ancestors', home)
        self.assertEqual(csp.policy('index.html', '', True)['directives']['frame-ancestors'], ["'self'"])
        self.assertIn(csp.BEACON_SCRIPT, home['script-src'])
        self.assertIn(csp.BEACON_CONNECT, home['connect-src'])
        self.assertEqual(home['report-uri'], [csp.REPORT_URL])

if __name__ == '__main__': unittest.main()
