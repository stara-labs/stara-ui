import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AppUpdatePrompt from './AppUpdatePrompt';

const update = jest.fn();
const getRegistration = jest.fn();

beforeEach(() => {
  window.__lcUpdateAvailable = undefined;
  update.mockReset();
  getRegistration.mockReset().mockResolvedValue({ update });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration },
  });
});

afterEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: undefined,
  });
});

describe('AppUpdatePrompt', () => {
  it('checks for an update without interrupting the current page', async () => {
    render(<AppUpdatePrompt />);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the activated update and refreshes only when requested', () => {
    const reload = jest.fn();
    render(<AppUpdatePrompt reload={reload} />);

    act(() => window.dispatchEvent(new Event('lc-sw-update-ready')));

    expect(screen.getByRole('status')).toHaveTextContent('Stara update ready');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Stara' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('restores an update announcement received before React mounted', () => {
    window.__lcUpdateAvailable = true;

    render(<AppUpdatePrompt />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
