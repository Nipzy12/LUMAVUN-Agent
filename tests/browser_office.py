"""Optional real-Chromium checks. Run with a Python that has Playwright installed.

LUMA_TEST_PYTHON selects the Python containing application dependencies.
No production dependencies or real provider calls are needed.
"""
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'browser-test-owner-token'


class OfficeBrowserTests(unittest.TestCase):
    @classmethod
    def api(cls, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = Request(cls.url + path, method=method, data=data,
                          headers={'X-Luma-Owner-Token': TOKEN, 'Content-Type': 'application/json'})
        with urlopen(request, timeout=10) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    @classmethod
    def start_server(cls):
        cls.server = subprocess.Popen([os.environ.get('LUMA_TEST_PYTHON', sys.executable),
                                       str(ROOT / 'tests/office_browser_server.py')],
                                      cwd=ROOT, env=cls.env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                cls.api('GET', '/api/health')
                return
            except Exception:
                if cls.server.poll() is not None:
                    raise RuntimeError('Mock server did not start')
                time.sleep(0.1)
        raise RuntimeError('Mock server readiness timed out')

    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='luma-office-browser-')
        cls.db = Path(cls.directory.name) / 'browser.db'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        cls.url = f'http://127.0.0.1:{port}'
        cls.env = dict(os.environ, DATABASE_URL=f'sqlite:///{cls.db}', LOCAL_OWNER_TOKEN=TOKEN,
                       LOCAL_OWNER_ID='browser-owner', APP_DEBUG='false', AI_PROVIDER='unavailable',
                       LUMA_UI_TEST_PORT=str(port), PYTHONPATH=str(ROOT))
        cls.log = open(Path(cls.directory.name) / 'server.log', 'w')
        cls.start_server()
        cls.api('POST', '/api/agents', {'name': 'Browser worker', 'job_type': 'backend engineer'})
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_BINARY') or shutil.which('chromium')
        cls.browser = cls.playwright.chromium.launch(executable_path=executable, headless=True,
                                                    args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop()
        cls.server.terminate(); cls.server.wait(timeout=10); cls.log.close(); cls.directory.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1280, 'height': 900})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('dialog', lambda dialog: dialog.accept())
        self.page.goto(self.url + '/office')
        self.connect()

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def wait_state(self, expression, timeout=10000):
        # wait_for_function(string) uses in-page eval, correctly blocked by CSP.
        # CDP function evaluation keeps the production CSP enabled for page scripts.
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            if self.page.evaluate('() => Boolean(' + expression + ')'):
                return
            self.page.wait_for_timeout(50)
        self.fail('UI state not reached: ' + expression)

    def connect(self):
        self.page.locator('#connectBtn').click()
        self.page.locator('#ownerTokenInput').fill(TOKEN)
        self.page.locator('#saveTokenBtn').click()
        self.wait_state("state.token && state.agents.length >= 2")

    def new_conversation(self):
        self.page.locator('#tabWork').click()
        self.page.locator('#workTaskBtn').click()
        self.wait_state('state.conversationId && !state.busy && state.conversation')
        self.page.locator('#jobTypeSelect').select_option('backend engineer')
        return self.page.evaluate('state.conversationId')

    def send(self, text):
        self.page.locator('#promptInput').fill(text)
        self.page.locator('#sendBtn').click()
        self.wait_state('!state.busy && selectedTask()?.status === "assigned"')
        return self.page.evaluate('state.selectedTask')

    def approve(self):
        self.page.get_by_role('button', name='1. Minta approval', exact=True).click()
        self.page.get_by_role('button', name='2. Setujui', exact=True).click()
        expect(self.page.get_by_role('button', name='3. Jalankan dengan AI', exact=True)).to_be_visible()

    def run_task(self):
        self.approve()
        self.page.get_by_role('button', name='3. Jalankan dengan AI', exact=True).click()
        self.wait_state('selectedTask()?.status === "completed" && state.runningTasks.size === 0')

    def test_direct_chat_sidebar_and_usage(self):
        self.page.locator('#newTaskBtn').click()
        self.wait_state('state.conversationId && !state.busy')
        cid = self.page.evaluate('state.conversationId')
        self.page.locator('#usageLevel').select_option('high')
        self.page.locator('#attachmentInput').set_input_files({'name':'note.txt','mimeType':'text/plain','buffer':b'Safe document preview'})
        expect(self.page.locator('#attachmentPreview')).to_contain_text('Safe document preview')
        self.page.locator('#attachmentPreview').get_by_role('button',name='Remove').click()
        expect(self.page.locator('#attachmentPreview')).to_be_empty()
        self.page.locator('#promptInput').fill('Remember Aurora')
        self.page.locator('#sendBtn').click()
        self.wait_state('!state.busy && state.messages.length === 2')
        self.assertTrue(all(m['task_id'] is None for m in self.api('GET', f'/api/conversations/{cid}')['messages']))
        expect(self.page.locator('[data-role="assistant"]')).to_contain_text('Aurora')
        self.page.keyboard.press('Control+Shift+s')
        expect(self.page.locator('#sidebar')).not_to_be_visible()
        self.page.locator('#menuToggle').click()
        expect(self.page.locator('#sidebar')).to_be_visible()
        self.page.set_viewport_size({'width':390,'height':844})
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),390)
        self.page.reload(); self.connect()
        self.wait_state('state.messages.length === 2')
        expect(self.page.locator('#usageLevel')).to_have_value('high')

    def test_two_turn_memory_refresh_restart_and_work(self):
        headers = []
        self.page.on('request', lambda request: headers.append(request.headers.get('x-luma-owner-token'))
                     if '/api/conversations' in request.url and request.method == 'GET' else None)
        cid = self.new_conversation()
        first = self.send('Remember our project is Aurora. Reply only ACK.')
        self.assertEqual(self.api('GET', f'/api/tasks/{first}')['status'], 'assigned')
        self.assertEqual(len(self.api('GET', f'/api/conversations/{cid}')['messages']), 1)
        self.run_task()
        expect(self.page.locator('[data-role="assistant"]')).to_have_text('LACK')
        self.send("What is our project's name? Reply only with the name.")
        self.run_task()
        expect(self.page.locator('[data-role="assistant"]').last).to_contain_text('Aurora')
        self.assertEqual(self.page.locator('[data-message-id]').count(), 4)
        self.assertTrue(headers and all(value == TOKEN for value in headers))
        self.assertEqual(self.page.evaluate('localStorage.length + sessionStorage.length'), 0)
        self.page.reload()
        expect(self.page.locator('#historyList')).to_contain_text('Sambungkan owner')
        self.assertEqual(self.page.locator('[data-message-id]').count(), 0)
        self.connect()
        self.wait_state('state.messages.length === 4')
        expect(self.page.locator('#jobTypeSelect')).to_have_value('backend engineer')
        self.server.terminate(); self.server.wait(timeout=10)
        type(self).start_server()
        self.page.locator('#refreshSide').click()
        self.wait_state('state.messages.length === 4')
        self.page.locator('#tabWork').click()
        expect(self.page.locator('#teamGrid')).to_contain_text('Browser worker')
        self.page.locator('#workTasks').get_by_role('button', name='Lihat').first.click()
        self.wait_state('state.view === "chat" && state.messages.length === 4')
        self.assertEqual(self.page.evaluate('state.conversationId'), cid)
        if os.environ.get('LUMA_UI_ARTIFACT_DIR'):
            directory = Path(os.environ['LUMA_UI_ARTIFACT_DIR']); directory.mkdir(parents=True, exist_ok=True)
            self.page.screenshot(path=str(directory / 'office-conversation.png'), full_page=True)

    def test_work_agent_creation_and_approval_controls(self):
        self.page.locator('#tabWork').click()
        count = self.page.evaluate('state.agents.length')
        self.page.locator('#createAgentBtn').click()
        self.page.locator('#agentName').fill('Worker created through Work')
        self.page.locator('#agentJob').select_option('backend engineer')
        self.page.locator('#agentSkills').fill('python, fastapi')
        self.page.locator('#createAgentSubmit').click()
        self.wait_state(f'!state.busy && state.agents.length === {count + 1}')
        expect(self.page.locator('#teamGrid')).to_contain_text('Worker created through Work')
        cid = self.new_conversation(); self.send('Work approval test')
        self.page.get_by_role('button', name='1. Minta approval', exact=True).click()
        self.wait_state('!state.busy && newestApproval(state.selectedTask)?.status === "pending"')
        self.page.locator('#tabWork').click()
        self.page.locator('#workApprovals').get_by_role('button', name='Setujui', exact=True).first.click()
        self.wait_state('!state.busy && newestApproval(state.selectedTask)?.status === "approved"')
        self.page.locator('#workTasks').get_by_role('button', name='Lihat').first.click()
        self.wait_state('!state.busy && state.view === "chat"')
        self.assertEqual(self.page.evaluate('state.conversationId'), cid)
        self.page.get_by_role('button', name='3. Jalankan dengan AI', exact=True).click()
        self.wait_state('selectedTask()?.status === "completed"')

    def test_invalid_replacement_token_clears_previous_private_data(self):
        self.new_conversation(); self.send('Private message before switching token')
        self.page.locator('#connectBtn').click()
        self.page.locator('#ownerTokenInput').fill('wrong-owner-token')
        self.page.locator('#saveTokenBtn').click()
        self.wait_state('!state.token && state.messages.length === 0')
        self.assertNotIn('Private message before switching token', self.page.locator('body').inner_text())
        self.assertEqual(self.page.evaluate('state.conversations.length'), 0)
        expect(self.page.locator('#ownerTokenInput')).to_have_value('')

    def test_lost_post_response_and_double_submit_do_not_duplicate(self):
        cid = self.new_conversation()
        def lose_response(route):
            route.fetch()  # Commit the real request, then lose only its response.
            route.abort('failed')
        self.page.route(f'**/api/conversations/{cid}/messages', lose_response, times=1)
        self.page.locator('#promptInput').fill('A message whose response gets lost')
        self.page.evaluate("document.getElementById('composerForm').requestSubmit(); document.getElementById('composerForm').requestSubmit();")
        self.wait_state('!state.busy && state.messages.length === 1')
        self.assertEqual(len(self.api('GET', f'/api/conversations/{cid}')['messages']), 1)
        self.assertEqual(self.page.locator('[data-message-id]').count(), 1)
        expect(self.page.locator('#promptInput')).to_have_value('')
        self.assertIsNone(self.page.evaluate('state.pendingSend'))

    def test_cancellation_while_execution_request_is_pending(self):
        cid = self.new_conversation()
        tid = self.send('SLOW'); self.approve()
        self.page.get_by_role('button', name='3. Jalankan dengan AI', exact=True).click()
        self.wait_state('selectedTask()?.status === "in_progress"')
        self.page.get_by_role('button', name='Batalkan task', exact=True).click()
        self.wait_state('selectedTask()?.status === "cancelled" && !state.busy')
        self.wait_state('state.runningTasks.size === 0', timeout=10000)
        self.assertEqual(self.api('GET', f'/api/tasks/{tid}')['status'], 'cancelled')
        self.assertEqual(len(self.api('GET', f'/api/conversations/{cid}')['messages']), 1)
        expect(self.page.locator('#sendBtn')).to_be_enabled()

    def test_untrusted_output_is_text_and_forget_clears_private_view(self):
        self.new_conversation(); self.send('HTML_PAYLOAD'); self.run_task()
        expect(self.page.locator('[data-role="assistant"]')).to_contain_text('<img src=x')
        self.assertEqual(self.page.locator('#chatThread img').count(), 0)
        self.assertIsNone(self.page.evaluate('window.__xss'))
        self.page.locator('#connectBtn').click(); self.page.locator('#forgetTokenBtn').click()
        self.assertEqual(self.page.locator('[data-message-id]').count(), 0)
        self.assertEqual(self.page.evaluate('state.token'), '')
        self.assertEqual(self.page.evaluate('localStorage.length + sessionStorage.length'), 0)
        expect(self.page.locator('#ownerTokenInput')).to_have_value('')

    def test_history_pagination_and_stale_response_after_logout(self):
        cid = self.new_conversation()
        with sqlite3.connect(self.db) as conn:
            conn.executemany('INSERT INTO conversation_messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)',
                             [(cid, 'assistant', f'Message {i}', '2026-01-01') for i in range(201)])
        self.page.locator('#refreshSide').click()
        self.wait_state('state.messages.length === 201')
        self.assertEqual(self.page.locator('[data-message-id]').count(), 201)
        self.assertIn('Message 200', self.page.locator('[data-message-id]').last.inner_text())
        held = []
        self.page.route('**/api/conversations?**', lambda route: held.append(route), times=1)
        self.page.locator('#refreshSide').click()
        self.page.wait_for_timeout(200)
        self.assertTrue(held)
        self.page.locator('#connectBtn').click(); self.page.locator('#forgetTokenBtn').click()
        held[0].fulfill(status=200, content_type='application/json', body=json.dumps({'items': [
            {'id': cid, 'title': 'PRIVATE_STALE_RESPONSE', 'updated_at': '2026-01-01'}]}))
        self.page.wait_for_timeout(200)
        self.assertNotIn('PRIVATE_STALE_RESPONSE', self.page.locator('body').inner_text())
        self.assertEqual(self.page.evaluate('state.conversations.length'), 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
