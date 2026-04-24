const test = require('node:test');
const assert = require('node:assert/strict');

const groceryListController = require('../groceryListController');
const groceryListService = require('../../services/groceryListService');

function createMockRes() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.payload = body;
            return this;
        },
    };
}

const originalAddMissingIngredientsToList = groceryListService.addMissingIngredientsToList;

test.after(() => {
    groceryListService.addMissingIngredientsToList = originalAddMissingIngredientsToList;
});

test('addMissingIngredientsToList returns 401 when user is missing', async () => {
    const req = {
        user: null,
        params: { listId: 'list-1' },
        body: {},
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.payload, { status: 'ERROR', message: 'Unauthorized' });
});

test('addMissingIngredientsToList adds one ingredient in single mode', async () => {
    groceryListService.addMissingIngredientsToList = async () => ({
        ok: true,
        added_count: 1,
        mode: 'single',
        source_surface: 'suggest',
        recipe: { id: 'meal-1', title: 'Pasta' },
        list: { _id: 'list-1', items: [{ name: 'Salt' }] },
    });

    const req = {
        user: { user_id: 42 },
        params: { listId: 'list-1' },
        body: {
            sourceSurface: 'suggest',
            recipeId: 'meal-1',
            recipeTitle: 'Pasta',
            mode: 'single',
            ingredients: ['Salt'],
        },
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'OK');
    assert.equal(res.payload.data.added_count, 1);
    assert.equal(res.payload.data.mode, 'single');
});

test('addMissingIngredientsToList adds multiple ingredients in all mode', async () => {
    groceryListService.addMissingIngredientsToList = async () => ({
        ok: true,
        added_count: 2,
        mode: 'all',
        source_surface: 'browse',
        recipe: { id: 'meal-2', title: 'Soup' },
        list: { _id: 'list-1', items: [{ name: 'Onion' }, { name: 'Garlic' }] },
    });

    const req = {
        user: { user_id: 42 },
        params: { listId: 'list-1' },
        body: {
            sourceSurface: 'browse',
            recipeId: 'meal-2',
            recipeTitle: 'Soup',
            mode: 'all',
            ingredients: ['Onion', 'Garlic'],
        },
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.status, 'OK');
    assert.equal(res.payload.data.added_count, 2);
    assert.equal(res.payload.data.mode, 'all');
});

test('addMissingIngredientsToList rejects invalid mode', async () => {
    const req = {
        user: { user_id: 42 },
        params: { listId: 'list-1' },
        body: {
            sourceSurface: 'suggest',
            recipeId: 'meal-1',
            mode: 'bulk',
            ingredients: ['Salt'],
        },
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { status: 'ERROR', message: 'mode must be single or all' });
});

test('addMissingIngredientsToList rejects empty ingredients array for all mode', async () => {
    const req = {
        user: { user_id: 42 },
        params: { listId: 'list-1' },
        body: {
            sourceSurface: 'suggest',
            recipeId: 'meal-1',
            mode: 'all',
            ingredients: [],
        },
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { status: 'ERROR', message: 'all mode requires at least one ingredient' });
});

test('addMissingIngredientsToList passes through service not-found errors', async () => {
    groceryListService.addMissingIngredientsToList = async () => ({
        ok: false,
        status: 404,
        message: 'Grocery list not found',
    });

    const req = {
        user: { user_id: 42 },
        params: { listId: 'missing-list' },
        body: {
            sourceSurface: 'browse',
            recipeId: 'meal-2',
            mode: 'single',
            ingredients: ['Onion'],
        },
    };
    const res = createMockRes();

    await groceryListController.addMissingIngredientsToList(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.payload, { status: 'ERROR', message: 'Grocery list not found' });
});
