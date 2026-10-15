import test from 'node:test';
import assert from 'node:assert/strict';
import { profilePayload } from '../src/http/confidence-handler';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';

const profile = { revision: 0, updatedAt: null, reports: [], examSubjects: null };

test('local profile exposes only its version-matched trial map', () => {
  const payload = profilePayload(profile, 'bookkeeping', DEVELOPMENT_CATALOG, true);
  assert.equal(payload.subjectMap?.version, DEVELOPMENT_CATALOG[0].version);
  assert.equal(payload.subjectMap?.status, 'draft');
  assert.equal(profilePayload(profile, 'income-tax', DEVELOPMENT_CATALOG, true).subjectMap, null);
});

test('published profile rejects draft map and mismatched pack rather than falling back', () => {
  assert.throws(() => profilePayload(profile, 'bookkeeping', DEVELOPMENT_CATALOG, false), /INVALID_SUBJECT_MAP/);
  const mismatch = [{ ...DEVELOPMENT_CATALOG[0], version: 'other-version' }];
  assert.throws(() => profilePayload(profile, 'bookkeeping', mismatch, true), /INVALID_SUBJECT_MAP/);
  assert.equal(profilePayload(profile, 'bookkeeping', [], false).subjectMap, null);
});
