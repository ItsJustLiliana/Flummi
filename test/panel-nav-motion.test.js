const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../panel/app.js'), 'utf8');
const helper = script.slice(script.indexOf('const subnavAnimations ='), script.indexOf('function setAnalyticsExpanded'));

function fixture({ height = 300, systemReduced = false, accountReduced = false } = {}) {
    const classes = new Set();
    const animations = [];
    let active;
    const subnav = {
        hidden: true,
        classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        getBoundingClientRect: () => ({ height: active ? 90 : height }),
        animate(frames, options) {
            const animation = { frames, options, cancel() { if (active === this) active = null; } };
            active = animation;
            animations.push(animation);
            return animation;
        }
    };
    const context = vm.createContext({
        window: { matchMedia: () => ({ matches: systemReduced }) },
        document: { documentElement: { classList: { contains: () => accountReduced } } },
        getComputedStyle: () => ({ opacity: active ? '0.5' : '1', marginBottom: '4px' })
    });
    vm.runInContext(helper, context);
    return { subnav, animations, classes, toggle: open => context.animateSubnav(subnav, open) };
}

test('category height and spacing animate in both directions on every toggle', () => {
    const { subnav, animations, classes, toggle } = fixture();
    for (let cycle = 0; cycle < 3; cycle++) {
        toggle(true);
        const opening = animations.at(-1);
        assert.equal(subnav.hidden, false);
        assert.equal(opening.frames[0].height, '0px');
        assert.equal(opening.frames[1].height, '300px');
        assert.ok(classes.has('is-expanding'));
        opening.onfinish();
        assert.ok(!classes.has('is-expanding'));
        toggle(false);
        const closing = animations.at(-1);
        assert.equal(subnav.hidden, false, 'keep space in layout until collapse finishes');
        assert.equal(subnav.inert, true);
        assert.equal(closing.frames[0].height, '300px');
        assert.equal(closing.frames[1].height, '0px');
        assert.equal(closing.frames[1].marginBottom, '-4px', 'collapse the parent grid gap too');
        closing.onfinish();
        assert.equal(subnav.hidden, true);
    }
});

test('rapid reversal starts at the current height and stale callbacks cannot hide a reopened category', () => {
    const { subnav, animations, toggle } = fixture();
    toggle(true);
    toggle(true);
    assert.equal(animations.length, 1);
    toggle(false);
    const closing = animations.at(-1);
    assert.equal(closing.frames[0].height, '90px');
    toggle(true);
    closing.onfinish();
    assert.equal(subnav.hidden, false);
    assert.equal(animations.at(-1).frames[0].height, '90px');
});

test('large categories cover more distance in the same time and reduced motion is immediate', () => {
    for (const height of [120, 1200]) {
        const { animations, toggle } = fixture({ height });
        toggle(true);
        assert.equal(animations[0].frames[1].height, `${height}px`);
        assert.equal(animations[0].options.duration, 180);
    }
    for (const preference of [{ systemReduced: true }, { accountReduced: true }]) {
        const { subnav, animations, toggle } = fixture(preference);
        toggle(true);
        assert.equal(subnav.hidden, false);
        toggle(false);
        assert.equal(subnav.hidden, true);
        assert.equal(animations.length, 0);
    }
});
