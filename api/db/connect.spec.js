const mockConnect = jest.fn();

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('@librechat/api', () => ({
  instrumentMongooseQueryMetrics: jest.fn(),
  isEnabled: jest.fn(),
}));
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn() },
}));
jest.mock('mongoose', () => ({
  connect: (...args) => mockConnect(...args),
  connection: { on: jest.fn() },
  set: jest.fn(),
}));

const originalEnvironment = { ...process.env };

describe('connectDb', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.mongoose;
    process.env = {
      ...originalEnvironment,
      MONGO_URI: '',
      STARA_NATIVE_RUNTIME: 'false',
    };
  });

  afterAll(() => {
    process.env = originalEnvironment;
    delete global.mongoose;
  });

  test('does not require or connect to Mongo in native mode', async () => {
    process.env.STARA_NATIVE_RUNTIME = 'true';
    const { connectDb } = require('./connect');

    await expect(connectDb()).resolves.toBeNull();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('defers the legacy MONGO_URI requirement until connection time', async () => {
    const { connectDb } = require('./connect');

    await expect(connectDb()).rejects.toThrow('Please define the MONGO_URI');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  test('retains the legacy Mongo connection path', async () => {
    process.env.MONGO_URI = 'mongodb://mongo/LibreChat';
    const connection = { _readyState: 1 };
    mockConnect.mockResolvedValue(connection);
    const { connectDb } = require('./connect');

    await expect(connectDb()).resolves.toBe(connection);
    expect(mockConnect).toHaveBeenCalledWith(
      'mongodb://mongo/LibreChat',
      expect.objectContaining({ bufferCommands: false }),
    );
  });
});
