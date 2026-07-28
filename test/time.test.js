import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateDurationMinutes, formatDuration, formatTokyoDateTime } from '../lib/time.js';

describe('formatDuration', () => {
  it('1時間未満は分だけで表示する', () => {
    assert.equal(formatDuration(45), '45分');
  });

  it('ちょうど1時間以上は分を省略する', () => {
    assert.equal(formatDuration(120), '2時間');
  });

  it('1時間以上で端数がある場合は時間と分を表示する', () => {
    assert.equal(formatDuration(135), '2時間15分');
  });
});

describe('calculateDurationMinutes', () => {
  it('開始時刻と終了時刻から分単位の作業時間を計算する', () => {
    assert.equal(
      calculateDurationMinutes('2026-07-29T10:30:00.000Z', '2026-07-29T12:45:00.000Z'),
      135,
    );
  });

  it('不正な日時は0分として扱う', () => {
    assert.equal(calculateDurationMinutes('invalid', '2026-07-29T12:45:00.000Z'), 0);
  });
});

describe('formatTokyoDateTime', () => {
  it('Asia/TokyoでM/D HH:mm形式にする', () => {
    assert.equal(formatTokyoDateTime('2026-07-29T10:30:00.000Z'), '7/29 19:30');
  });

  it('不正な日時は日時不明にする', () => {
    assert.equal(formatTokyoDateTime('invalid'), '日時不明');
  });
});
