const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFeedbackStore } = require('../stores/feedback-store');

function temporaryStore(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-feedback-'));
    let currentTime = 1_700_000_000_000;
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return {
        store: createFeedbackStore({
            feedbackFilePath: path.join(directory, 'feedback.json'),
            rateLimitFilePath: path.join(directory, 'rate-limits.json'),
            now: () => currentTime
        }),
        advance(milliseconds) { currentTime += milliseconds; }
    };
}

test('feedback submissions allow one message per minute', t => {
    const clock = temporaryStore(t);
    clock.store.addFeedback({ userId: 'one', username: 'User', message: 'First' });

    assert.throws(
        () => clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Too soon' }),
        error => error.code === 'FEEDBACK_RATE_LIMITED' && error.retryAfterSeconds === 60
    );

    clock.advance(60 * 1000);
    assert.equal(clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Allowed' }).message, 'Allowed');
});

test('feedback submissions are capped at five per rolling hour per user', t => {
    const clock = temporaryStore(t);
    for (let index = 0; index < 5; index++) {
        clock.store.addFeedback({ userId: 'one', username: 'User', message: `Message ${index + 1}` });
        if (index < 4) clock.advance(60 * 1000);
    }

    assert.throws(
        () => clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Sixth' }),
        error => error.code === 'FEEDBACK_RATE_LIMITED' && error.retryAfterSeconds === 56 * 60
    );
    assert.equal(clock.store.addFeedback({ userId: 'two', username: 'Other', message: 'Independent user' }).message, 'Independent user');

    clock.advance(56 * 60 * 1000);
    assert.equal(clock.store.addFeedback({ userId: 'one', username: 'User', message: 'New hour' }).message, 'New hour');
});

test('deleting feedback removes its message without resetting submission limits', t => {
    const clock = temporaryStore(t);
    const feedback = clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Remove me' });

    assert.equal(clock.store.deleteFeedback(feedback.id)?.id, feedback.id);
    assert.deepEqual(clock.store.readFeedback(), []);
    assert.equal(clock.store.deleteFeedback(feedback.id), null);
    assert.equal(clock.store.getRateLimit('one').remainingThisHour, 4);
    assert.equal(clock.store.getRateLimit('one').allowed, false);
});

test('support and feedback share limits and keep a DM conversation thread', t => {
    const clock = temporaryStore(t);
    const support = clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Please help', type: 'support' });
    assert.equal(support.type, 'support');
    assert.equal(support.messages[0].source, 'website');
    assert.throws(
        () => clock.store.addFeedback({ userId: 'one', username: 'User', message: 'Feedback too soon', type: 'feedback' }),
        error => error.code === 'FEEDBACK_RATE_LIMITED'
    );

    clock.store.appendMessage(support.id, { direction: 'out', content: 'We can help.', authorId: 'developer' });
    clock.store.appendMessage(support.id, { direction: 'in', content: 'Thank you.', authorId: 'one', source: 'discord-dm' });
    const thread = clock.store.findOpenThreadForUser('one');
    assert.deepEqual(thread.messages.map(message => message.direction), ['in', 'out', 'in']);
    assert.equal(thread.messages.at(-1).source, 'discord-dm');
    assert.equal(thread.status, 'new');
});
