import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

type WorkerListener = (event: Record<string, unknown>) => void;

const runActivation = async (hadController: boolean) => {
  const listeners: Record<string, WorkerListener> = {};
  let activation: Promise<void> | undefined;
  const client = {
    id: 'client-1',
    frameType: 'top-level',
    navigate: jest.fn(),
    postMessage: jest.fn((message: { type: string }) => {
      if (message.type === 'LC_SW_PING') {
        listeners.message({
          data: { type: 'LC_SW_PONG', hadController },
          source: client,
        });
      }
    }),
  };
  const worker = {
    addEventListener: jest.fn((type: string, listener: WorkerListener) => {
      listeners[type] = listener;
    }),
    clients: {
      claim: jest.fn().mockResolvedValue(undefined),
      matchAll: jest.fn().mockResolvedValue([client]),
    },
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../../../sw/heal.js'), 'utf8');
  vm.runInNewContext(source, { self: worker, Map, Promise, setTimeout });

  listeners.activate({
    waitUntil: (promise: Promise<void>) => {
      activation = promise;
    },
  });
  await activation;
  return client;
};

describe('service worker update healing', () => {
  it('announces an update to a responsive page controlled by the prior worker', async () => {
    const client = await runActivation(true);

    expect(client.postMessage).toHaveBeenCalledWith({ type: 'LC_SW_UPDATE_READY' });
    expect(client.navigate).not.toHaveBeenCalled();
  });

  it('does not announce the first service worker installation as an update', async () => {
    const client = await runActivation(false);

    expect(client.postMessage).not.toHaveBeenCalledWith({ type: 'LC_SW_UPDATE_READY' });
    expect(client.navigate).not.toHaveBeenCalled();
  });
});
