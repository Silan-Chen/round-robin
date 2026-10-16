import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(testDirectory, '..', 'index.html');

function loadCore() {
  if (!fs.existsSync(indexPath)) return null;

  const html = fs.readFileSync(indexPath, 'utf8');
  const match = html.match(/<script data-core>([\s\S]*?)<\/script>/);
  if (!match) return null;

  const context = {};
  context.globalThis = context;
  vm.runInNewContext(match[1], context);
  return context.__TournamentCore ?? null;
}

test('opens the guide only for a first-time visitor without tournament history', () => {
  const core = loadCore();

  assert.equal(core.shouldAutoOpenGuide({ hasSeenGuide: false, tournamentCount: 0 }), true);
  assert.equal(core.shouldAutoOpenGuide({ hasSeenGuide: true, tournamentCount: 0 }), false);
  assert.equal(core.shouldAutoOpenGuide({ hasSeenGuide: false, tournamentCount: 1 }), false);
});

function loadUiWithStoredValue(storedValue) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/g)];
  const coreScript = scripts.find(([tag]) => tag.includes('data-core'))?.[1];
  const appScript = scripts.find(([tag]) => !tag.includes('data-core'))?.[1];
  const app = { innerHTML: '' };
  const inertElement = { addEventListener: () => {} };
  const context = {
    document: {
      querySelector: (selector) => (selector === '#app' ? app : inertElement),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    localStorage: { getItem: () => storedValue, setItem: () => {} },
  };
  context.globalThis = context;
  vm.runInNewContext(coreScript, context);
  vm.runInNewContext(appScript, context);
  return { app, context };
}

function renderAppWithStoredValue(storedValue) {
  return loadUiWithStoredValue(storedValue).app.innerHTML;
}

function renderCompletedTournamentAndClickSave(tournament) {
  const { app, context } = loadUiWithStoredValue(JSON.stringify([tournament]));
  const listeners = new Map();
  const control = (selector, value = '') => ({
    value,
    addEventListener: (eventName, handler) => listeners.set(`${selector}:${eventName}`, handler),
  });
  const controls = new Map([
    ['#home-button', control('#home-button')],
    ['#add-member', control('#add-member')],
    ['#remove-member', control('#remove-member')],
    ['#score-a', control('#score-a')],
    ['#score-b', control('#score-b')],
    ['#score-a-value', control('#score-a-value')],
    ['#score-b-value', control('#score-b-value')],
    ['#save-score', control('#save-score')],
    ['#guide-root', { innerHTML: '' }],
  ]);
  const inertElement = { addEventListener: () => {} };
  context.document.querySelector = (selector) => (selector === '#app' ? app : controls.get(selector) ?? inertElement);
  context.__TournamentUi.state.currentId = tournament.id;
  context.__TournamentUi.state.view = 'tournament';
  context.__TournamentUi.renderTournament();
  listeners.get('#save-score:click')();
  return app.innerHTML;
}

test('labels the score action as saving the current match result', () => {
  const tournament = {
    id: 'save-label',
    name: '按钮文案赛事',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [],
  };
  const { app, context } = loadUiWithStoredValue(JSON.stringify([tournament]));

  context.__TournamentUi.state.currentId = tournament.id;
  context.__TournamentUi.renderTournament();

  assert.match(app.innerHTML, /<button class="primary" id="save-score">保存本场比赛结果<\/button>/);
});

test('shows a completion dialog when every result is already recorded', () => {
  const tournament = {
    id: 'completed-save',
    name: '已完成赛事',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [
      { participantAId: 'a', participantBId: 'b', scoreA: 3, scoreB: 1 },
      { participantAId: 'a', participantBId: 'c', scoreA: 3, scoreB: 1 },
      { participantAId: 'b', participantBId: 'c', scoreA: 3, scoreB: 1 },
    ],
  };

  const markup = renderCompletedTournamentAndClickSave(tournament);

  assert.match(markup, /class="success-modal" role="alertdialog"/);
  assert.match(markup, /<h2 id="completion-title">比赛已完成<\/h2>/);
  assert.match(markup, /所有比赛结果已经录入，可下滑查看比赛排名。/);
  assert.doesNotMatch(markup, /请选择两位有效的参赛者。/);
});

test('groups mobile match items by round and filters completed results', () => {
  const tournament = {
    id: 'mobile-test',
    name: '手机端赛事',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [{ participantAId: 'a', participantBId: 'b', scoreA: 3, scoreB: 1 }],
  };
  const { context } = loadUiWithStoredValue(JSON.stringify([tournament]));
  const mobileItems = context.__TournamentUi.getMobileMatchItems;

  assert.equal(mobileItems(tournament, 'all').length, 3);
  assert.equal(mobileItems(tournament, 'pending').length, 2);
  assert.equal(mobileItems(tournament, 'completed').length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(mobileItems(tournament, 'completed')[0].pair)),
    { key: 'a::b', participantAId: 'a', participantBId: 'b' },
  );
});

test('does not create a mobile match item for a five-player bye', () => {
  const participants = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({ id, name: id.toUpperCase(), order }));
  const tournament = { participants, results: [] };
  const { context } = loadUiWithStoredValue(null);

  const items = context.__TournamentUi.getMobileMatchItems(tournament, 'all');

  assert.equal(items.length, 10);
  assert.equal(items.every(({ pair }) => pair.participantAId !== '__bye__' && pair.participantBId !== '__bye__'), true);
});

test('renders completed cards once and shows an empty completed filter', () => {
  const tournament = {
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [{ participantAId: 'a', participantBId: 'b', scoreA: 3, scoreB: 1 }],
  };
  const byId = new Map(tournament.participants.map((participant) => [participant.id, participant]));
  const { context } = loadUiWithStoredValue(null);

  const completed = context.__TournamentUi.renderMobileMatchList(tournament, byId, 'completed');
  const empty = context.__TournamentUi.renderMobileMatchList({ ...tournament, results: [] }, byId, 'completed');

  assert.match(completed, /data-pair="a::b"/);
  assert.match(completed, /data-complete="true"/);
  assert.equal((completed.match(/data-pair="a::b"/g) ?? []).length, 1);
  assert.match(empty, /还没有已完成的比赛。/);
});

test('renders the desktop-style matrix instead of mobile match cards', () => {
  const tournament = {
    id: 'mobile-render',
    name: '移动渲染赛事',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [{ participantAId: 'a', participantBId: 'b', scoreA: 3, scoreB: 1 }],
  };
  const { app, context } = loadUiWithStoredValue(JSON.stringify([tournament]));
  const ui = context.__TournamentUi;

  ui.state.currentId = tournament.id;
  ui.renderTournament();

  assert.match(app.innerHTML, /<h2>循环赛表格<\/h2><div class="matrix-wrap">/);
  assert.match(app.innerHTML, /<table class="matrix">/);
  assert.equal((app.innerHTML.match(/data-pair="a::b"/g) ?? []).length, 2);
  assert.equal((app.innerHTML.match(/data-complete="true"/g) ?? []).length, 2);
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(html, /@media \(max-width:620px\) \{[\s\S]*?\.mobile-match-section \{ display:none; \}[\s\S]*?\.matrix-wrap::before \{ content:'← 左右滑动查看完整表格 →';[\s\S]*?\.matrix th:first-child,\.matrix td:first-child \{ position:sticky;/);
});

test('formats a completed result in the mobile card participant order', () => {
  const { context } = loadUiWithStoredValue(null);
  const result = { participantAId: 'b', participantBId: 'd', scoreA: 3, scoreB: 1 };

  assert.equal(context.__TournamentUi.formatResultScore(result, 'd'), '1:3');
  assert.equal(context.__TournamentUi.formatResultScore(result, 'b'), '3:1');
});

test('labels each mobile score field with its corresponding participant', () => {
  const tournament = {
    id: 'mobile-labels',
    name: '录分标签赛事',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
    participants: [
      { id: 'a', name: '甲', order: 0 },
      { id: 'b', name: '乙', order: 1 },
      { id: 'c', name: '丙', order: 2 },
    ],
    results: [],
  };
  const { app, context } = loadUiWithStoredValue(JSON.stringify([tournament]));

  context.__TournamentUi.state.currentId = tournament.id;
  context.__TournamentUi.renderTournament();

  assert.match(app.innerHTML, /选手 A<select id="score-a"/);
  assert.match(app.innerHTML, /选手 B<select id="score-b"/);
  assert.match(app.innerHTML, /选手 A 的比赛大比分<input id="score-a-value"/);
  assert.match(app.innerHTML, /选手 B 的比赛大比分<input id="score-b-value"/);
});

test('shows a welcome introduction before the five-step guide on an empty first visit', () => {
  const markup = renderAppWithStoredValue(null);

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /3 分钟了解如何使用/);
  assert.match(markup, /1 \/ 5/);
  assert.match(markup, /欢迎使用/);
  assert.match(markup, /帮助用户登记循环赛比分的小型 Demo/);
  assert.match(markup, /希望大家使用愉快/);
});

test('updates the guide inside its own mount point without re-rendering the page', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  assert.match(html, /id="guide-root"/);
  assert.match(html, /function renderGuideOverlay\(\)[\s\S]*?root\.innerHTML = guideMarkup\(\)/);
  assert.match(html, /function openGuide\(\)\s*\{\s*state\.guideStep = 0;\s*state\.guideOpen = true;\s*renderGuideOverlay\(\);\s*\}/);
  assert.match(html, /function closeGuide\(\)\s*\{\s*state\.guideOpen = false;\s*rememberGuideSeen\(\);\s*renderGuideOverlay\(\);\s*\}/);
});

test('shows stored-data errors in a dismissible dialog', () => {
  const markup = renderAppWithStoredValue('{not-json');

  assert.match(markup, /role="alertdialog"/);
  assert.match(markup, /本机保存的数据不完整/);
  assert.match(markup, /data-dismiss-message/);
});

test('rejects a tournament with fewer than three participants', () => {
  const core = loadCore();
  assert.ok(core, 'TournamentCore must be available from index.html');

  const result = core.validateTournamentInput({
    name: '周末循环赛',
    participantNames: ['张三', '李四'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'participant-count-too-small');
  assert.match(result.issue.reason, /至少需要 3 人/);
  assert.match(result.issue.impact, /无法开始/);
  assert.match(result.issue.remedy, /添加 1 名参赛者/);
});

test('rejects a tournament with more than sixteen participants', () => {
  const result = loadCore().validateTournamentInput({
    name: '人数上限测试',
    participantNames: Array.from({ length: 17 }, (_, index) => `选手${index + 1}`),
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'participant-count-too-large');
  assert.match(result.issue.reason, /最多支持 16 人/);
  assert.match(result.issue.impact, /无法开始/);
  assert.match(result.issue.remedy, /删除多余成员/);
});

test('rejects an empty tournament name with an actionable explanation', () => {
  const result = loadCore().validateTournamentInput({
    name: '   ',
    participantNames: ['张三', '李四', '王五'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'tournament-name-empty');
  assert.match(result.issue.reason, /比赛名称不能为空/);
  assert.match(result.issue.impact, /无法创建/);
  assert.match(result.issue.remedy, /填写比赛名称/);
});

test('rejects a blank participant name with its position and a remedy', () => {
  const result = loadCore().validateTournamentInput({
    name: '姓名测试',
    participantNames: ['张三', ' ', '王五'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'participant-name-empty');
  assert.match(result.issue.reason, /第 2 位参赛者没有姓名/);
  assert.match(result.issue.impact, /无法开始/);
  assert.match(result.issue.remedy, /填写姓名/);
});

test('rejects duplicate names after trimming whitespace', () => {
  const result = loadCore().validateTournamentInput({
    name: '重名测试',
    participantNames: [' 张三', '李四', '张三 '],
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'participant-name-duplicate');
  assert.match(result.issue.reason, /张三出现了两次/);
  assert.match(result.issue.impact, /无法开始/);
  assert.match(result.issue.remedy, /补充区分信息/);
});

test('creates a tournament with stable participants in input order', () => {
  const core = loadCore();
  const tournament = core.createTournament(
    {
      name: '  周末循环赛  ',
      participantNames: [' 张三 ', '李四', '王五'],
    },
    '2026-10-16T09:00:00.000Z',
  );

  assert.equal(tournament.name, '周末循环赛');
  assert.equal(tournament.createdAt, '2026-10-16T09:00:00.000Z');
  assert.deepEqual(
    tournament.participants.map(({ name, order }) => ({ name, order })),
    [
      { name: '张三', order: 0 },
      { name: '李四', order: 1 },
      { name: '王五', order: 2 },
    ],
  );
  assert.equal(new Set(tournament.participants.map(({ id }) => id)).size, 3);
  assert.equal(tournament.results.length, 0);
});

test('lists every unique pairing exactly once', () => {
  const core = loadCore();
  const participants = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({
    id,
    name: id.toUpperCase(),
    order,
  }));

  const pairings = core.listPairings(participants);

  assert.equal(pairings.length, 10);
  assert.equal(new Set(pairings.map(({ key }) => key)).size, 10);
  assert.equal(core.normalizeMatchKey('a', 'b'), core.normalizeMatchKey('b', 'a'));
  assert.deepEqual(
    Array.from(pairings, ({ key }) => key).sort(),
    ['a::b', 'a::c', 'a::d', 'a::e', 'b::c', 'b::d', 'b::e', 'c::d', 'c::e', 'd::e'],
  );
});

test('builds a five-person round robin with one bye per round and every pairing', () => {
  const core = loadCore();
  const participants = ['a', 'b', 'c', 'd', 'e'].map((id, order) => ({
    id,
    name: id.toUpperCase(),
    order,
  }));

  const rounds = core.buildRecommendedRounds(participants);
  const pairingKeys = rounds.flatMap((round) => round.matches.map(({ key }) => key));

  assert.equal(rounds.length, 5);
  assert.equal(rounds.every((round) => round.matches.length === 2), true);
  assert.equal(rounds.every((round) => typeof round.byeParticipantId === 'string'), true);
  assert.equal(new Set(pairingKeys).size, 10);
  assert.equal(pairingKeys.length, 10);
});

test('builds a four-person round robin without byes', () => {
  const core = loadCore();
  const participants = ['a', 'b', 'c', 'd'].map((id, order) => ({
    id,
    name: id.toUpperCase(),
    order,
  }));

  const rounds = core.buildRecommendedRounds(participants);

  assert.equal(rounds.length, 3);
  assert.equal(rounds.every((round) => round.matches.length === 2), true);
  assert.equal(rounds.every((round) => round.byeParticipantId === undefined), true);
});

test('keeps the expected pairing count at the supported participant boundaries', () => {
  const core = loadCore();

  for (const participantCount of [3, 16]) {
    const participants = Array.from({ length: participantCount }, (_, order) => ({
      id: `p${order + 1}`,
      name: `选手${order + 1}`,
      order,
    }));
    assert.equal(core.listPairings(participants).length, (participantCount * (participantCount - 1)) / 2);
  }
});

test('reads an empty local tournament store as an empty history', () => {
  const result = loadCore().readTournamentStore({
    getItem: () => null,
  });

  assert.equal(result.ok, true);
  assert.equal(result.tournaments.length, 0);
});

test('explains how to recover when stored tournament data is malformed', () => {
  const result = loadCore().readTournamentStore({
    getItem: () => '{not-json',
  });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'storage-data-invalid');
  assert.match(result.issue.reason, /数据不完整/);
  assert.match(result.issue.impact, /没有修改原数据/);
  assert.match(result.issue.remedy, /返回首页/);
});

test('does not report a save as successful when local storage throws', () => {
  const result = loadCore().writeTournamentStore(
    {
      setItem: () => {
        throw new Error('quota');
      },
    },
    [],
  );

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'storage-write-failed');
  assert.match(result.issue.reason, /无法保存到本机/);
  assert.match(result.issue.impact, /关闭页面后/);
  assert.match(result.issue.remedy, /允许本地存储/);
});

function threePlayerTournament() {
  return loadCore().createTournament(
    { name: '核心赛果测试', participantNames: ['张三', '李四', '王五'] },
    '2026-10-16T10:00:00.000Z',
  );
}

test('saves one valid large-score result and prevents duplicate pairings', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li] = tournament.participants;
  const first = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }, '2026-10-16T10:01:00.000Z');

  assert.equal(first.ok, true);
  assert.equal(first.tournament.results.length, 1);
  assert.equal(first.tournament.results[0].scoreA, 3);
  const duplicate = core.saveResult(first.tournament, { participantAId: li.id, participantBId: zhang.id, scoreA: 1, scoreB: 3 });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.issue.code, 'match-already-complete');
  assert.match(duplicate.issue.remedy, /清除原成绩/);
});

test('rejects a drawn or invalid large score with an explanation', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li] = tournament.participants;
  const result = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 3 });

  assert.equal(result.ok, false);
  assert.equal(result.issue.code, 'score-tied');
  assert.match(result.issue.reason, /不能相同/);
  assert.match(result.issue.impact, /无法保存/);
  assert.match(result.issue.remedy, /不同的比分/);
});

test('clears only the selected result and preserves other results', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li, wang] = tournament.participants;
  const one = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }).tournament;
  const two = core.saveResult(one, { participantAId: zhang.id, participantBId: wang.id, scoreA: 3, scoreB: 2 }).tournament;
  const cleared = core.clearResult(two, zhang.id, li.id, '2026-10-16T10:02:00.000Z');

  assert.equal(cleared.ok, true);
  assert.equal(cleared.tournament.results.length, 1);
  assert.equal(cleared.tournament.results[0].participantBId, wang.id);
});

test('adds members at the end and deletes only results involving the removed member', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li, wang] = tournament.participants;
  const withResult = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }).tournament;
  const added = core.addParticipant(withResult, '赵六', '2026-10-16T10:03:00.000Z');
  assert.equal(added.ok, true);
  assert.equal(added.tournament.participants.at(-1).name, '赵六');
  const removed = core.removeParticipant(added.tournament, li.id, '2026-10-16T10:04:00.000Z');
  assert.equal(removed.ok, true);
  assert.equal(removed.tournament.participants.some(({ id }) => id === li.id), false);
  assert.equal(removed.tournament.results.length, 0);
  assert.equal(removed.tournament.participants.some(({ id }) => id === wang.id), true);
});

test('marks unresolved three-way circular ties in red-ready standings data', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li, wang] = tournament.participants;
  const one = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }).tournament;
  const two = core.saveResult(one, { participantAId: li.id, participantBId: wang.id, scoreA: 3, scoreB: 1 }).tournament;
  const three = core.saveResult(two, { participantAId: wang.id, participantBId: zhang.id, scoreA: 3, scoreB: 1 }).tournament;
  const standings = core.calculateStandings(three);

  assert.equal(standings.isFinal, true);
  assert.deepEqual(Array.from(standings.rows, ({ rank }) => rank), [1, 1, 1]);
  assert.equal(standings.rows.every(({ isUnresolvedTie }) => isUnresolvedTie), true);
});

test('explains final unresolved ties after every match is complete', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li, wang] = tournament.participants;
  const one = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }).tournament;
  const two = core.saveResult(one, { participantAId: li.id, participantBId: wang.id, scoreA: 3, scoreB: 1 }).tournament;
  const three = core.saveResult(two, { participantAId: wang.id, participantBId: zhang.id, scoreA: 3, scoreB: 1 }).tournament;

  assert.equal(
    core.getFinalStandingsNote(core.calculateStandings(three)),
    '红色选手表示并列。并列原因：这些选手总胜场相同，且相互交手的小循环胜场也相同，当前规则无法继续区分名次。',
  );
});

test('does not show a tie explanation when final standings are resolved', () => {
  const core = loadCore();
  const tournament = threePlayerTournament();
  const [zhang, li, wang] = tournament.participants;
  const one = core.saveResult(tournament, { participantAId: zhang.id, participantBId: li.id, scoreA: 3, scoreB: 1 }).tournament;
  const two = core.saveResult(one, { participantAId: zhang.id, participantBId: wang.id, scoreA: 3, scoreB: 1 }).tournament;
  const three = core.saveResult(two, { participantAId: li.id, participantBId: wang.id, scoreA: 3, scoreB: 1 }).tournament;

  assert.equal(core.getFinalStandingsNote(core.calculateStandings(three)), null);
});

test('does not mark head-to-head winners as tied after a completed four-player tournament', () => {
  const core = loadCore();
  const tournament = core.createTournament(
    { name: '四人排名测试', participantNames: ['111', '222', '333', '444'] },
    '2026-10-16T11:00:00.000Z',
  );
  const [one, two, three, four] = tournament.participants;
  const oneResult = core.saveResult(tournament, { participantAId: three.id, participantBId: two.id, scoreA: 3, scoreB: 1 }).tournament;
  const twoResult = core.saveResult(oneResult, { participantAId: three.id, participantBId: four.id, scoreA: 3, scoreB: 1 }).tournament;
  const threeResult = core.saveResult(twoResult, { participantAId: one.id, participantBId: three.id, scoreA: 3, scoreB: 1 }).tournament;
  const fourResult = core.saveResult(threeResult, { participantAId: two.id, participantBId: one.id, scoreA: 3, scoreB: 1 }).tournament;
  const fiveResult = core.saveResult(fourResult, { participantAId: two.id, participantBId: four.id, scoreA: 3, scoreB: 1 }).tournament;
  const completed = core.saveResult(fiveResult, { participantAId: four.id, participantBId: one.id, scoreA: 3, scoreB: 1 }).tournament;

  const standings = core.calculateStandings(completed);

  assert.deepEqual(
    Array.from(standings.rows, ({ name, rank, isUnresolvedTie }) => ({ name, rank, isUnresolvedTie })),
    [
      { name: '333', rank: 1, isUnresolvedTie: false },
      { name: '222', rank: 2, isUnresolvedTie: false },
      { name: '444', rank: 3, isUnresolvedTie: false },
      { name: '111', rank: 4, isUnresolvedTie: false },
    ],
  );
  assert.equal(core.getFinalStandingsNote(standings), null);
});
