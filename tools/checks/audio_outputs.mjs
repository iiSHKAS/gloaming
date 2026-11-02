// Node 24: node tools/checks/audio_outputs.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const code = stripTypeScriptTypes(readFileSync(new URL('../../ui-src/lib/audioOutputs.ts', import.meta.url), 'utf8'));
const {outputSlots, outputTracks, slotsForPrimary} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const primary = 'device:game.monitor';
const second = 'device:chat.monitor';
const third = 'device:music.monitor';
assert.deepEqual(outputSlots({gsr_audio_source: primary}), [
  {source: '', enabled: false}, {source: '', enabled: false},
]);
assert.deepEqual(outputTracks(primary, outputSlots({gsr_audio_source: primary})), [primary]);
const slots = [{source: second, enabled: false}, {source: third, enabled: true}];
assert.deepEqual(outputSlots({audio_output_slots: slots}), slots);
assert.deepEqual(outputTracks(primary, slots), [primary, third]);
const changed = slotsForPrimary(third, slots);
assert.deepEqual(outputTracks(third, changed), [third]);
assert.equal(changed[1].enabled, false);
assert.equal(changed[0].source, second); // Disabled choices are retained.
assert.deepEqual(outputSlots({gsr_audio_source: primary, microphone_source: 'device:mic',
  audio_tracks: [primary, second, 'device:mic', 'default_input']}), [
  {source: second, enabled: true}, {source: '', enabled: false},
]);
assert.deepEqual(outputTracks(primary, [{source: primary, enabled: true}, {source: third, enabled: true}]), [primary, third]);
console.log('Audio output synchronization checks passed.');
