"""Build-only CSP inventory. Generates proposals; never changes response headers.

Python 3 standard library only. Fail closed on HTML constructs outside the reviewed
static entrypoint syntax instead of pretending this is a complete HTML5 parser.
"""
import argparse
import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlsplit

ORIGIN = 'https://app.chasingmajors.com'
BEACON_SCRIPT = 'https://static.cloudflareinsights.com'
BEACON_CONNECT = 'https://cloudflareinsights.com'
REPORT_URL = 'https://csp-report.chasingmajors.com/report'
JS_TYPES = {'module', 'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript', 'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript'}
def executable(attrs):
    kind = attrs.get('type', '').strip().lower().split(';')[0]
    if kind in {'importmap', 'speculationrules'}:
        raise ValueError('Active script configuration requires explicit CSP review: ' + kind)
    return not kind or kind in JS_TYPES
PAGES = {
    'index.html': {'paths': ['/', '/index.html'], 'connect': ['https://api.chasingmajors.com'], 'fonts': ['data:']},
    'checklists/index.html': {'paths': ['/checklists/', '/checklists/index.html'], 'connect': ['https://api.chasingmajors.com', 'https://script.google.com', 'https://script.googleusercontent.com']},
    'vault/index.html': {'paths': ['/vault/', '/vault/index.html'], 'connect': ['https://script.google.com', 'https://script.googleusercontent.com']},
    'ChatBot/index.html': {'paths': ['/ChatBot/', '/ChatBot/index.html'], 'connect': ['https://script.google.com', 'https://script.googleusercontent.com']},
}

def digest(body):
    return 'sha256-' + base64.b64encode(hashlib.sha256(body.encode('utf-8')).digest()).decode('ascii')

class Inventory(HTMLParser):
    def __init__(self, name, text):
        super().__init__(convert_charrefs=False)
        self.name, self.block, self.blocks, self.external, self.style_attributes = name, None, [], [], 0
        if '\x00' in text or '\ufeff' in text:
            raise ValueError('Unsupported NUL/BOM in entrypoint')
        self.feed(text.replace('\r\n', '\n').replace('\r', '\n'))
        self.close()
        if self.block:
            raise ValueError('Unclosed script/style')

    def handle_starttag(self, tag, attrs):
        if len({k for k, _ in attrs}) != len(attrs):
            raise ValueError('Duplicate HTML attribute')
        a = dict(attrs)
        if tag in {'base', 'iframe', 'frame', 'object', 'embed', 'template', 'noscript'}:
            raise ValueError('Unreviewed embedding/base/parser construct: ' + tag)
        if any(k.startswith('on') or (v and re.sub(r'[\t\r\n]', '', v).strip().lower().startswith('javascript:')) for k, v in attrs):
            raise ValueError('Inline event handler/javascript URL requires review')
        if tag == 'meta' and a.get('http-equiv', '').lower() == 'content-security-policy':
            raise ValueError('Entrypoint must not introduce an independent meta CSP')
        self.style_attributes += int('style' in a)
        if tag in {'script', 'style'}:
            self.block = {'kind': tag, 'attrs': a, 'line': self.getpos()[0], 'text': ''}
        if tag == 'script' and 'src' in a:
            self.resource(a['src'], 'script', {ORIGIN, BEACON_SCRIPT})
        if tag == 'link' and 'stylesheet' in a.get('rel', '').lower().split():
            self.resource(a.get('href'), 'style', {'https://app.chasingmajors.com', 'https://fonts.googleapis.com'})

    def handle_startendtag(self, tag, attrs):
        if tag in {'script', 'style'}:
            raise ValueError('Self-closing raw-text element')
        self.handle_starttag(tag, attrs)

    def resource(self, value, kind, allowed):
        if not value:
            raise ValueError('Empty resource URL')
        u = urlsplit(urljoin(ORIGIN + '/' + self.name, value))
        origin = u.scheme + '://' + u.netloc
        if origin not in allowed or u.username or u.password:
            raise ValueError('Unreviewed ' + kind + ' origin: ' + origin)
        self.external.append({'kind': kind, 'url': u.geturl(), 'origin': origin})

    def handle_data(self, data):
        if self.block:
            self.block['text'] += data

    def handle_endtag(self, tag):
        if self.block and tag == self.block['kind']:
            b, self.block = self.block, None
            # HTML5 double-escaped script parsing differs from HTMLParser here.
            if re.search(r'<!--|<script\b', b['text'], re.I):
                raise ValueError('Ambiguous raw-text parsing requires review')
            if b['kind'] == 'style' or ('src' not in b['attrs'] and executable(b['attrs'])):
                self.blocks.append({'kind': b['kind'], 'line': b['line'], 'hash': digest(b['text']),
                                    'bytes': len(b['text'].encode()), 'type': b['attrs'].get('type', '')})
            elif 'src' in b['attrs'] and b['text'].strip():
                raise ValueError('External script with nonempty inline body')

def policy(name, text, framing=False):
    inventory, profile = Inventory(name, text), PAGES[name]
    hashes = lambda kind: sorted({"'" + x['hash'] + "'" for x in inventory.blocks if x['kind'] == kind})
    styles = sorted({x['origin'] for x in inventory.external if x['kind'] == 'style' and x['origin'] != ORIGIN})
    directives = {
        'default-src': ["'none'"], 'script-src': ["'self'", BEACON_SCRIPT, *hashes('script')], 'script-src-attr': ["'none'"],
        'style-src': ["'self'", *hashes('style'), *styles], 'style-src-attr': ["'unsafe-inline'"],
        'img-src': ["'self'"], 'font-src': ["'self'", *profile.get('fonts', ['https://fonts.gstatic.com'])],
        'connect-src': ["'self'", *profile['connect'], BEACON_CONNECT], 'frame-src': ["'none'"], 'worker-src': ["'none'"],
        'media-src': ["'none'"], 'manifest-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'none'"],
        'form-action': ["'self'"], 'report-uri': [REPORT_URL], 'report-to': ['cm-csp']}
    if framing:
        directives['frame-ancestors'] = ["'self'"]
    return {'page': name, 'paths': profile['paths'], 'html_sha256': hashlib.sha256(text.encode()).hexdigest(),
            'inline': inventory.blocks, 'external': inventory.external, 'style_attributes': inventory.style_attributes,
            'directives': directives, 'value': '; '.join(k + ' ' + ' '.join(v) for k, v in directives.items())}

def generate(root, sha, framing=False):
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Pinned source SHA required')
    pages = [policy(name, (root / name).read_bytes().decode('utf-8'), framing) for name in PAGES]
    framed = [policy(name, (root / name).read_bytes().decode('utf-8'), True) for name in PAGES]
    unframed = [policy(name, (root / name).read_bytes().decode('utf-8'), False) for name in PAGES]
    return {'schema_version': 1, 'state': 'STAGED', 'source_sha': sha, 'origin': ORIGIN, 'pages': pages,
            'enforcement_approved': False, 'recommended_variant': 'without-frame-ancestors',
            'variants': {'with_frame_ancestors': framed, 'without_frame_ancestors': unframed},
            'reporting_endpoints': 'cm-csp="' + REPORT_URL + '"', 'delivery': 'Draft values for existing exact-path Cloudflare rules; not automatically applied',
            'required_approval_gates': ['Clean report-only normal-flow evidence',
                                        'Inbound embed decision', 'Explicit owner production approval']}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path)
    parser.add_argument('--sha')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--framing', choices=['none', 'self'], default='none')
    args = parser.parse_args()
    if args.inspect:
        value = json.load(sys.stdin)
        result = []
        for item in value:
            try:
                parsed = policy(item['page'], item['html'])
                result.append({'page': item['page'], 'inline': parsed['inline'], 'external': parsed['external']})
            except (ValueError, KeyError) as error:
                result.append({'page': item.get('page'), 'error': str(error)})
        print(json.dumps(result))
        raise SystemExit(0)
    if not args.root or not args.sha or not args.out:
        parser.error('--root --sha --out are required for generation')
    result = generate(args.root.resolve(), args.sha, args.framing == 'self')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'state': 'STAGED', 'pages': len(result['pages']), 'source_sha': args.sha}))
