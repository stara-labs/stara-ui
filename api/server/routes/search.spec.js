const express = require('express');
const request = require('supertest');

let mockNativeRuntime = false;
const mockHealth = jest.fn();

jest.mock('@librechat/api', () => ({
  isEnabled: (value) => String(value).toLowerCase() === 'true',
}));
jest.mock('~/server/middleware/requireJwtAuth', () => (_req, _res, next) => next());
jest.mock('~/server/services/StaraNativeRuntime', () => ({
  staraNativeRuntimeEnabled: () => mockNativeRuntime,
}));
jest.mock('meilisearch', () => ({
  MeiliSearch: jest.fn(() => ({ health: mockHealth })),
}));

const searchRouter = require('./search');

describe('search routes', () => {
  const originalSearch = process.env.SEARCH;
  const app = express().use('/api/search', searchRouter);

  beforeEach(() => {
    jest.clearAllMocks();
    mockNativeRuntime = false;
    process.env.SEARCH = 'true';
  });

  afterAll(() => {
    if (originalSearch == null) {
      delete process.env.SEARCH;
    } else {
      process.env.SEARCH = originalSearch;
    }
  });

  test('reports Postgres search without probing Meili in native mode', async () => {
    mockNativeRuntime = true;

    const response = await request(app).get('/api/search/enable');

    expect(response.status).toBe(200);
    expect(response.body).toBe(true);
    expect(mockHealth).not.toHaveBeenCalled();
  });

  test('retains the Meili health check for the legacy runtime', async () => {
    mockHealth.mockResolvedValue({ status: 'available' });

    const response = await request(app).get('/api/search/enable');

    expect(response.body).toBe(true);
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });

  test('honors the global search kill switch in both runtimes', async () => {
    mockNativeRuntime = true;
    process.env.SEARCH = 'false';

    const response = await request(app).get('/api/search/enable');

    expect(response.body).toBe(false);
    expect(mockHealth).not.toHaveBeenCalled();
  });
});
