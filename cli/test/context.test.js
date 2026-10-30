import { test } from 'node:test';
import assert from 'node:assert/strict';
import { context } from '../src/commands/context.js';
import { push } from '../src/commands/push.js';
import { callTool } from '../src/mcp.js';
import { autoComment, keyContext, roleAt } from '../src/usage.js';
import { tempDir, writeFiles, testContext, fakeServer, testEnv } from './helpers.js';

const unit = (value) => ({ stringUnit: { state: 'translated', value } });

/** One app on all four platforms, each using its keys the way real code does. */
function app() {
  const root = tempDir();
  writeFiles(root, {
    'locli.json': { project: 'app', sourceLanguage: 'en', targets: [
      { platform: 'ios', format: 'xcstrings', path: 'ios/Localizable.xcstrings' },
      { platform: 'android', format: 'android-xml', path: 'android/app/src/main/res' },
      { platform: 'web', format: 'json', path: 'web/messages/{locale}.json' },
      { platform: 'backend', format: 'json', path: 'server/locales/{locale}.json' },
    ] },
    'ios/Localizable.xcstrings': { sourceLanguage: 'en', version: '1.0', strings: {
      editor_save: { localizations: { en: unit('Save'), de: unit('Speichern unter') } },
      editor_title: { localizations: { en: unit('Edit text'), de: unit('Text bearbeiten') } },
      editor_delete_a11y: { localizations: { en: unit('Delete this text and all of its translations') } },
      old_unused: { localizations: { en: unit('Gone') } },
    } },
    'ios/Editor/EditorView.swift': `struct EditorView: View {
  var body: some View {
    Form { TextField("auth_email_label", text: $email) }
      .navigationTitle("editor_title")
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("editor_save") { save() }
        }
      }
    Image(systemName: "trash").accessibilityLabel("editor_delete_a11y")
  }
}`,
    'ios/EditorTests/EditorTests.swift': 'XCTAssertEqual(String(localized: "old_unused"), "Gone")',
    'android/app/src/main/res/values/strings.xml': `<resources>
  <string name="tab_home">Home</string>
  <string name="auth_email_label">Email</string>
</resources>`,
    'android/app/src/main/res/values-de/strings.xml': '<resources>\n  <string name="tab_home">Startseite und mehr</string>\n</resources>',
    'android/app/src/main/res/layout/login.xml': `<EditText
    android:id="@+id/email"
    android:hint="@string/auth_email_label" />`,
    'android/app/src/main/java/app/Nav.kt': `NavigationBarItem(
    selected = true,
    label = { Text(stringResource(R.string.tab_home)) },
)`,
    'web/messages/en.json': { checkout_pay: 'Pay now', checkout_intro: 'Check your order before you pay.' },
    'web/messages/de.json': { checkout_pay: 'Jetzt kostenpflichtig bezahlen' },
    'web/src/Checkout.tsx': `export function Checkout() {
  return <section>
    <p>{t("checkout_intro")}</p>
    <button type="submit">
      {t("checkout_pay")}
    </button>
  </section>;
}`,
    'server/locales/en.json': { mail_welcome_subject: 'Welcome to Shoply', push_order_shipped: 'Your order is on its way', error_card_declined: 'Your card was declined.' },
    'server/src/mailers/welcome.js': 'await send({ to, subject: i18n.t("mail_welcome_subject") });',
    'server/src/notifications.py': 'body = _("push_order_shipped")',
    'server/src/payments.rb': 'raise PaymentError, I18n.t("error_card_declined")',
  });
  return root;
}

test('context finds each key\'s role on iOS, Android, web and backend', async () => {
  const root = app();
  const ctx = testContext({ cwd: root });
  const report = await context(ctx, { json: true });
  const roles = Object.fromEntries(report.keys.map((k) => [k.key, k.role]));
  assert.deepEqual(roles, {
    auth_email_label: 'field', // SwiftUI TextField and Android android:hint
    checkout_intro: 'text',
    checkout_pay: 'button', // <button> two lines above
    editor_delete_a11y: 'accessibility',
    editor_save: 'toolbar', // a Button inside ToolbarItem is a toolbar item
    editor_title: 'title',
    error_card_declined: 'error',
    mail_welcome_subject: 'email',
    push_order_shipped: 'notification', // from the file name
    tab_home: 'tab',
  });
  const email = report.keys.find((k) => k.key === 'auth_email_label');
  assert.deepEqual(email.platforms, ['android']); // the platforms whose files define it; the code uses it on both
  assert.deepEqual(email.uses.map((u) => u.file), ['android/app/src/main/res/layout/login.xml', 'ios/Editor/EditorView.swift']);
  // Tests don't count as a use.
  assert.deepEqual(report.unused, ['old_unused']);
  assert.deepEqual(report.tooLong.map((i) => [i.key, i.locale, i.maxChars]).sort(), [
    ['checkout_pay', 'de', 20], ['editor_save', 'de', 12], ['tab_home', 'de', 12],
  ]);
  const text = testContext({ cwd: root });
  await context(text, {});
  assert.match(text.output.join('\n'), /editor_save +toolbar item ≤ 12 +ios\/Editor\/EditorView\.swift:7/);
  assert.match(text.output.join('\n'), /3 translations longer than the place they are used in/);
  const tool = await callTool('locli_context', { key: 'editor' }, { cwd: root });
  assert.deepEqual(JSON.parse(tool.content[0].text).keys.map((k) => k.key), ['editor_delete_a11y', 'editor_save', 'editor_title']);
});

test('the budget grows with the source text, and the comment says how to write it', () => {
  const uses = [{ file: 'a.swift', line: 1, role: 'text' }, { file: 'b.swift', line: 2, role: 'button' }];
  const short = keyContext(uses, 'Save');
  assert.deepEqual([short.role, short.maxChars], ['button', 20]);
  assert.equal(keyContext(uses, 'Continue with your Apple account').maxChars, 42);
  assert.equal(autoComment(short), 'Used as a button: a short verb phrase, at most about 20 characters.');
  assert.equal(autoComment(keyContext([{ file: 'x', line: 1, role: 'error' }])), 'Used as an error message: a full sentence that says what to do.');
  // On the line itself, an aria-label wins over the surrounding <button>.
  const line = '  <Icon aria-label={t("x")} />';
  assert.equal(roleAt(['<button>', line], 1, 'a.tsx', line.indexOf('"x"')), 'accessibility');
  // A pattern that doesn't enclose the key doesn't count: setTitle(…) in the click handler, a closed menu item above.
  const cancel = '<JumpButton onClick={() => { setTitle(feature.title); }}>{t("Abbrechen")}</JumpButton>';
  assert.equal(roleAt([cancel], 0, 'a.tsx', cancel.indexOf('"Abbrechen"')), 'button');
  const status = '<span role="status">{t("Wird gespeichert…")}</span>';
  assert.equal(roleAt(['<JumpMenuItem onClick={add}>{t("Add")}</JumpMenuItem>', '</ActionMenu>', status], 2, 'a.tsx', status.indexOf('"Wird')), 'text');
  // A finished sibling prop or a self-closed component above doesn't enclose the key.
  const row = '<ToggleRow title={t("Technische Ansicht")} description={technical ? t("Zeigt Codes") : t("Zeigt Platzhalter")} />';
  assert.equal(roleAt([row], 0, 'a.tsx', row.indexOf('"Zeigt Codes"')), 'text');
  const frame = ['<AppFrame title={t("Store")}', '  actions={[{ label: t("Verwalten"), onClick }]}', '  subtitle={t("Alles für den Store")}>'];
  assert.equal(roleAt(frame, 1, 'a.tsx', frame[1].indexOf('"Verwalten"')), 'toolbar');
  assert.equal(roleAt(frame, 2, 'a.tsx', frame[2].indexOf('"Alles')), 'text');
});

test('push warns about too-long texts and fills empty context from the code, never a written one', async () => {
  const server = await fakeServer({ slug: 'app', defaultLocale: 'en', locales: ['en'], platforms: ['ios', 'android', 'web', 'backend'],
    keys: [{ key: 'editor_title', platforms: ['ios'], comment: 'Title of the text editor' }, { key: 'checkout_intro', platforms: ['web'], comment: 'Used as a button: old guess.' }] });
  try {
    const root = app();
    const dry = testContext({ cwd: root, env: testEnv(server.url) });
    const plan = await push(dry, { dryRun: true });
    assert.deepEqual(plan.tooLong.map((i) => i.key).sort(), ['checkout_pay', 'editor_save', 'tab_home']);
    assert.match(dry.warnings.join('\n'), /editor_save \(de\): 15 characters, a toolbar item fits about 12: “Speichern unter”/);
    assert.match(dry.output.join('\n'), /editor_save: Used as a toolbar item: one or two words, at most about 12 characters\. \(ios\/Editor\/EditorView\.swift:7\)/);

    await push(testContext({ cwd: root, env: testEnv(server.url) }), {});
    const comment = (/** @type {string} */ name) => server.state.keys.find((k) => k.key === name).comment;
    assert.equal(comment('editor_save'), 'Used as a toolbar item: one or two words, at most about 12 characters.');
    assert.equal(comment('mail_welcome_subject'), 'Used as an email text: a subject stays under about 60 characters.');
    assert.equal(comment('editor_title'), 'Title of the text editor'); // written by a person: kept
    assert.equal(comment('checkout_intro'), 'Used as a text: may wrap.'); // generated earlier: refreshed
  } finally { await server.close(); }
});
