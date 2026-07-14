/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaraControlPlaneView from '../StaraControlPlaneView';

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

jest.mock('../StaraEngineeringWorkspace', () => ({
  __esModule: true,
  default: ({ view }: { view: string }) => <div>Live {view} workspace</div>,
}));

jest.mock('../StaraOrganizationControl', () => ({
  __esModule: true,
  default: () => <div>Organization control</div>,
}));

function renderSection(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/stara/:section" element={<StaraControlPlaneView />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StaraControlPlaneView', () => {
  it('redirects the legacy launcher route to the live workflows workspace', () => {
    renderSection('/stara/launcher');

    expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
    expect(screen.getByText('Live workflows workspace')).toBeInTheDocument();
  });

  it('redirects legacy memory routes to activity', () => {
    renderSection('/stara/memory');

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('Live activity workspace')).toBeInTheDocument();
  });

  it('keeps canonical organization management as one section', () => {
    renderSection('/stara/organization');

    expect(screen.getByRole('heading', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.getByText('Organization control')).toBeInTheDocument();
  });
});
