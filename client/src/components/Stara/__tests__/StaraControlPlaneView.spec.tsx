import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaraControlPlaneView from '../StaraControlPlaneView';

jest.mock('@librechat/client', () => ({
  useMediaQuery: () => false,
}));

describe('StaraControlPlaneView', () => {
  it('renders the memory review surface and source graph', () => {
    render(
      <MemoryRouter initialEntries={['/stara/memory']}>
        <Routes>
          <Route path="/stara/:section" element={<StaraControlPlaneView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByText('Memory Review')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Memory source graph' })).toBeInTheDocument();
    expect(
      screen.getByText('Operations approvers prefer workflow blockers first in summaries.'),
    ).toBeInTheDocument();
  });
});
