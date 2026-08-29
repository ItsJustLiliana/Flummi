const test = require('node:test');
const assert = require('node:assert/strict');
const statusCommand = require('../commands/status');

test('status command includes live server and Discord connection details', () => {
    const source = statusCommand.execute.toString();
    assert.match(source, /name: 'Server status'/);
    assert.match(source, /interaction\.guild\?\.memberCount/);
    assert.match(source, /interaction\.client\.isReady\(\)/);
    assert.match(source, /interaction\.client\.ws\.ping/);
});
