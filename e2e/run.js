// Two people editing at once, end to end: person A in the real site, person B through the API.
// Creates (or reuses) records named "Concurrency Test", takes small test payments, and edits test notes, so it must
// only ever run against a TEST COPY of the database:  node run.js --test-database
const { api, browser, tab, openClient, fieldInput, shownMessages, shot, login } = require('./lib');

if (!process.argv.includes('--test-database')) {
    console.error('These tests create records and take payments. Run them only against a test copy of the database:\n'
        + '  node run.js --test-database');
    process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const pause = (page, ms = 1500) => page.waitForTimeout(ms);
const saveChanges = (page) => page.locator('button:has-text("Save Changes") >> visible=true').first().click();

// The test records, created the first time and put back to a known state on every run
async function setUp(me) {
    const t = {};
    const clients = (await api('GET', '/clients?status=all')).body;
    let client = clients.find(c => c.lastname === 'Test' && c.firstname === 'Concurrency');
    if (!client) {
        const r = await api('POST', '/clients', { firstname: 'Concurrency', lastname: 'Test', programtype: 'State SO', phase: 'Phase 1 - Weekly', programstatus: 'Active', programstartdate: '2026-11-01', mainphone: '555-0100', createdBy: me });
        client = { clientid: r.body.clientId };
    }
    t.clientId = client.clientid;
    await api('PATCH', `/clients/${t.clientId}`, { mainphone: '555-0100', updatedBy: me });

    const email = 'concurrency.test@stop.local';
    if (!(await api('GET', '/admin/employees')).body.some(e => e.employeeemail === email)) {
        await api('POST', '/admin/employees', { employeeEmail: email, displayName: 'Concurrency Test Employee', role: 'Office Admin', location: 'Oklahoma City', active: true, password: `Tmp-${Date.now()}!aA1` });
    }
    await api('PUT', `/admin/employees/${encodeURIComponent(email)}`, { displayName: 'Concurrency Test Employee', role: 'Office Admin', active: true, updatedBy: me });
    t.employeeEmail = email;

    let agent = (await api('GET', '/agents')).body.find(a => a.name === 'Concurrency Test Agent');
    if (!agent) agent = (await api('POST', '/agents', { name: 'Concurrency Test Agent', phone: '555-0101', email: 'agent@test.local', user: me })).body;
    await api('PUT', `/agents/${agent.agentid}`, { name: 'Concurrency Test Agent', phone: '555-0101', email: 'agent@test.local', user: me });
    t.agentId = agent.agentid;

    t.counselors = (await api('GET', '/admin/employees')).body.filter(e => e.role === 'Counselor' && e.active !== false).map(e => e.displayname);
    if (t.counselors.length < 2) throw new Error('The group test needs two active counselors in the database.');
    let group = (await api('GET', '/groups')).body.find(g => g.groupname === 'Concurrency Test Group');
    const groupFields = { groupName: 'Concurrency Test Group', location: 'Oklahoma City', counselor: t.counselors[0], programType: 'SO', schedule: 'Mondays @ 6:00 PM', address: '1 Test St', active: true };
    if (!group) await api('POST', '/groups', groupFields);
    group = (await api('GET', '/groups')).body.find(g => g.groupname === 'Concurrency Test Group');
    await api('PUT', `/groups/${group.groupid}`, groupFields);
    t.groupId = group.groupid;

    let price = (await api('GET', '/session-types')).body.find(p => p.name.startsWith('Concurrency Test Session'));
    if (!price) price = (await api('POST', '/session-types', { category: 'Individual', name: 'Concurrency Test Session', fee: 50, kind: 'Standard', bipOnly: false, soOnly: false, lateFee: null, active: true, user: me })).body;
    await api('PUT', `/session-types/${price.sessiontypeid}`, { category: 'Individual', name: 'Concurrency Test Session', fee: 50, kind: 'Standard', bipOnly: false, soOnly: false, lateFee: null, active: true, user: me });
    t.priceId = price.sessiontypeid;
    return t;
}

const scenarios = {
    async 'client: payment while editing the phone'({ page, t, me }) {
        const client = async () => (await api('GET', `/clients/${t.clientId}`)).body;
        await openClient(page);
        await page.getByRole('button', { name: 'Edit Info' }).click();
        await fieldInput(page, 'Main Phone').fill('555-0142');
        const pay = await api('POST', '/financials/payment', { client: t.clientId, amount: 25, paymentMethod: 'Cash', comments: 'e2e: payment while editing', createdBy: me });
        await saveChanges(page);
        await pause(page, 2000);
        const now = await client();
        check('a payment taken while the phone is edited is kept', Number(now.accountbalance) === pay.body.newBalance, `balance ${now.accountbalance}, expected ${pay.body.newBalance}`);
        check('the phone edit saves', now.mainphone === '555-0142', now.mainphone);
    },

    async 'client: both change the phone'({ page, t, me }) {
        const client = async () => (await api('GET', `/clients/${t.clientId}`)).body;
        await page.getByRole('button', { name: 'Edit Info' }).click();
        await fieldInput(page, 'Main Phone').fill('555-0200');
        const cur = await client();
        await api('PATCH', `/clients/${t.clientId}`, { mainphone: '555-0300', expected: { mainphone: cur.mainphone }, updatedBy: me });
        await saveChanges(page);
        await pause(page);
        check('the second save is refused and says what changed', /Main Phone \(now 555-0300\)/.test(await shownMessages(page)));
        check('the other person\'s phone is kept', (await client()).mainphone === '555-0300');
        check('what was typed stays in the form', (await fieldInput(page, 'Main Phone').inputValue()) === '555-0200');
        await saveChanges(page);
        await pause(page);
        check('saving again replaces it on purpose', (await client()).mainphone === '555-0200');
    },

    async 'client: balance edited while a payment is taken'({ page, t, me }) {
        const client = async () => (await api('GET', `/clients/${t.clientId}`)).body;
        await page.getByRole('button', { name: 'Edit Info' }).click();
        await fieldInput(page, 'Account Balance').fill('100');
        const pay = await api('POST', '/financials/payment', { client: t.clientId, amount: 10, paymentMethod: 'Cash', comments: 'e2e: payment during balance edit', createdBy: me });
        await saveChanges(page);
        await pause(page);
        check('the balance edit is refused', /Account Balance \(now/.test(await shownMessages(page)));
        check('the payment is kept', Number((await client()).accountbalance) === pay.body.newBalance);
        await page.getByRole('button', { name: 'Cancel' }).first().click();
    },

    async 'notes: edit and delete'({ page, t, me }) {
        const stamp = Date.now();
        const add = async (text) => (await api('POST', `/clients/${t.clientId}/notes`, { user: me, comments: text, category: 'Admin' })).body;
        const noteNow = async (id) => (await api('GET', `/clients/${t.clientId}/notes`)).body.find(n => n.noteid === id);
        const toEdit = await add(`e2e note to edit ${stamp}`);
        const toDelete = await add(`e2e note to delete ${stamp}`);
        // Notes load when the account opens, so open it again to see the two just added
        const close = page.locator('button[aria-label="Close account"] >> visible=true');
        if (await close.count()) { await close.first().click(); await pause(page, 600); }
        await openClient(page);
        await page.locator('text=/^(Case Notes|Notes)$/ >> visible=true').first().click();
        await pause(page, 1200);
        const card = (text) => page.locator('div', { hasText: text }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();

        await card(toEdit.comments).getByRole('button', { name: 'Edit' }).click();
        await page.locator('textarea >> visible=true').first().fill('A\'s version');
        await page.getByRole('button', { name: 'Done' }).click();
        await api('PUT', `/notes/${toEdit.noteid}`, { user: me, comments: 'B\'s version', original: toEdit.comments });
        await saveChanges(page);
        await pause(page);
        check('a note edited by someone else meanwhile is not overwritten', (await noteNow(toEdit.noteid)).comments === 'B\'s version');
        check('the refusal names who edited it', /edited by .+ while you were editing/.test(await shownMessages(page)));
        await saveChanges(page);
        await pause(page);
        check('saving the note again replaces it on purpose', (await noteNow(toEdit.noteid)).comments === 'A\'s version');

        await card(toDelete.comments).getByRole('button', { name: 'Delete' }).click();
        await api('PUT', `/notes/${toDelete.noteid}`, { user: me, comments: `${toDelete.comments}, now updated`, original: toDelete.comments });
        await saveChanges(page);
        await pause(page);
        check('a note edited meanwhile is not deleted unseen', !!(await noteNow(toDelete.noteid)));
        check('the refused delete is explained', /Not deleted/.test(await shownMessages(page)));
        check('the note\'s new text is shown', (await page.locator(`text=${toDelete.comments}, now updated >> visible=true`).count()) > 0);
        await page.locator('button[aria-label="Close account"] >> visible=true').first().click().catch(() => {});
    },

    async 'employee account: deactivated while renamed'({ page, t, me }) {
        const account = async () => (await api('GET', '/admin/employees')).body.find(e => e.employeeemail === t.employeeEmail);
        await tab(page, /^Admin$/);
        await page.locator('input[placeholder="Search by name or email..."] >> visible=true').fill('Concurrency Test');
        await pause(page, 600);
        await page.locator('div', { hasText: 'Concurrency Test Employee' }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last().getByRole('button', { name: 'Edit' }).click();
        const name = page.locator('input[placeholder="Full Display Name"] >> visible=true');
        await name.fill('Concurrency Test Employee (renamed)');
        const before = await account();
        await api('PUT', `/admin/employees/${encodeURIComponent(t.employeeEmail)}`, { displayName: before.displayname, role: before.role, active: false, updatedBy: me, expected: before });
        await saveChanges(page);
        await pause(page, 2000);
        let now = await account();
        check('the account stays deactivated', now.active === false);
        check('nothing from the stale form is saved', now.displayname === 'Concurrency Test Employee');
        check('the refusal says Active changed', /Active \(now no\)/.test(await shownMessages(page)));
        check('the form reloads showing the account inactive', (await page.locator('label:has-text("Active (inactive accounts") input[type=checkbox] >> visible=true').isChecked()) === false);
        await name.fill('Concurrency Test Employee (renamed)');
        await saveChanges(page);
        await pause(page);
        now = await account();
        check('redoing the rename on the fresh form saves it, still inactive', now.displayname.endsWith('(renamed)') && now.active === false);
    },

    async 'group: counselor changed while the address is edited'({ page, t }) {
        const group = async () => (await api('GET', '/groups')).body.find(g => g.groupid === t.groupId);
        await tab(page, /^Groups$/);
        await page.locator('tr:has-text("Concurrency Test Group") >> visible=true').first().click();
        await pause(page, 1000);
        await page.locator('button:has-text("Group Detai") >> visible=true').first().click();
        const address = page.locator('label:text-is("Address") >> visible=true').locator('xpath=..').locator('input');
        await address.fill('2 Edited Ave');
        const g = await group();
        await api('PUT', `/groups/${t.groupId}`, { groupName: g.groupname, location: g.location, counselor: t.counselors[1], programType: g.programtype, schedule: g.schedule, address: g.address, active: true, expected: g });
        await page.locator('button:has-text("Save Group Settings") >> visible=true').click();
        await pause(page, 2000);
        let now = await group();
        check('the other counselor change is kept and the stale save refused', now.counselor === t.counselors[1] && now.address === '1 Test St', `${now.counselor} / ${now.address}`);
        check('the refusal says the counselor changed', /Counselor \(now/.test(await shownMessages(page)));
        await address.fill('2 Edited Ave');
        await page.locator('button:has-text("Save Group Settings") >> visible=true').click();
        await pause(page);
        await address.fill('3 Edited Ave');
        await page.locator('button:has-text("Save Group Settings") >> visible=true').click();
        await pause(page);
        now = await group();
        check('redo saves, and a second save from the same form is not a false conflict', now.address === '3 Edited Ave' && now.counselor === t.counselors[1], `${now.address} / ${now.counselor}`);
    },

    async 'supervising agent: email changed while the phone is edited'({ page, t, me }) {
        const agent = async () => (await api('GET', '/agents')).body.find(a => a.agentid === t.agentId);
        await tab(page, /Agents/);
        await page.locator('input[placeholder="Search by name, phone, or email..."] >> visible=true').fill('Concurrency Test');
        await pause(page, 600);
        const edit = () => page.locator('tr:has-text("Concurrency Test Agent") button[title="Edit"] >> visible=true').first().click();
        await edit();
        await page.locator('input[placeholder="Phone Number"] >> visible=true').fill('555-0199');
        const a = await agent();
        const bSave = await api('PUT', `/agents/${t.agentId}`, { name: a.name, phone: a.phone, email: 'new.agent@test.local', user: me, expected: a });
        check('an ordinary agent edit saves', bSave.status === 200, `HTTP ${bSave.status}`);
        await saveChanges(page);
        await pause(page);
        const now = await agent();
        check('the other email change is kept and the stale save refused', now.email === 'new.agent@test.local' && now.phone === '555-0101');
        check('the form reloads with the new email', (await page.locator('input[placeholder="Email"] >> visible=true').inputValue()) === 'new.agent@test.local');
        await page.locator('input[placeholder="Phone Number"] >> visible=true').fill('555-0177');
        await saveChanges(page);
        await pause(page);
        check('redoing the phone edit saves', (await agent()).phone === '555-0177');
    },

    async 'price list: price raised while renamed'({ page, t, me }) {
        const price = async () => (await api('GET', '/session-types')).body.find(p => p.sessiontypeid === t.priceId);
        await tab(page, /^Admin$/);
        await page.locator('tr, li, div', { hasText: 'Concurrency Test Session' }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last().getByRole('button', { name: 'Edit' }).click();
        await page.locator('[aria-label="Name"] >> visible=true').fill('Concurrency Test Session (renamed)');
        const p = await price();
        await api('PUT', `/session-types/${t.priceId}`, { category: p.category, name: p.name, fee: 75, kind: p.kind, bipOnly: p.biponly, soOnly: p.soonly, lateFee: p.latefee, active: p.active, user: me, expected: p });
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await pause(page);
        const now = await price();
        check('the new price is kept and the stale save refused', now.fee === '75.00' && now.name === 'Concurrency Test Session');
        check('the form reloads with $75.00', (await page.locator('[aria-label="Price"] >> visible=true').inputValue()) === '75.00');
        await page.locator('[aria-label="Price"] >> visible=true').fill('80');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await pause(page);
        check('an ordinary price edit saves', (await price()).fee === '80.00');
    },

    async 'open account refreshes on coming back to the window'({ page, t, me }) {
        await openClient(page);
        const badge = async () => (await page.getByText(/ Balance$/).filter({ visible: true }).first().innerText()).trim();
        const pay = await api('POST', '/financials/payment', { client: t.clientId, amount: 5, paymentMethod: 'Cash', comments: 'e2e: refresh on return', createdBy: me });
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await pause(page);
        check('the balance updates on return', (await badge()).includes((-pay.body.newBalance).toFixed(2)), await badge());
    },
};

(async () => {
    const me = login().email;
    const t = await setUp(me);
    const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const { b, page } = await browser();
    for (const [name, run] of Object.entries(scenarios)) {
        if (only.length && !only.some(o => name.includes(o))) continue;
        console.log(`\n-- ${name}`);
        try {
            await run({ page, t, me });
        } catch (err) {
            check(`${name} ran to the end`, false, err.message.split('\n')[0]);
            await shot(page, name.replace(/[^a-z0-9]+/gi, '-'));
            // Start the next scenario from a clean page
            await page.reload();
            await pause(page, 1000);
            const { email, password } = login();
            if (await page.locator('input[type=password]').count()) {
                await page.fill('input[type=email]', email);
                await page.fill('input[type=password]', password);
                await page.keyboard.press('Enter');
                await pause(page, 2500);
            }
        }
    }
    await b.close();
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
