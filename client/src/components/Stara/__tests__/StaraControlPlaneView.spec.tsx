import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaraControlPlaneView from '../StaraControlPlaneView';

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

describe('StaraControlPlaneView', () => {
  it('renders the context review surface and source graph', () => {
    render(
      <MemoryRouter initialEntries={['/stara/context']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Vault / Context' })).toBeInTheDocument();
    expect(screen.getByText('Memory Review')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Memory source graph' })).toBeInTheDocument();
    expect(
      screen.getByText('Operations approvers prefer workflow blockers first in summaries.'),
    ).toBeInTheDocument();
  });

  it('renders the launcher and operational route summaries', () => {
    render(
      <MemoryRouter initialEntries={['/stara/launcher']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Launcher' })).toBeInTheDocument();
    expect(screen.getByText('Stara Gateway')).toBeInTheDocument();
    expect(screen.getByText('stara-control-plane')).toBeInTheDocument();
  });

  it('redirects old memory route aliases to the context shell route', () => {
    render(
      <MemoryRouter initialEntries={['/stara/memory']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Vault / Context' })).toBeInTheDocument();
  });
});
