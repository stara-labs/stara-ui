import { renderHook } from '@testing-library/react';
import useUnifiedSidebarLinks from '../useUnifiedSidebarLinks';

jest.mock('recoil', () => ({
  useRecoilValue: () => ({ endpoint: 'openAI' }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: { expiresAt: '2099-01-01T00:00:00.000Z' } }),
}));

jest.mock('librechat-data-provider', () => ({
  getConfigDefaults: () => ({ interface: {} }),
  getEndpointField: () => 'openAI',
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: {} } }),
  useGetEndpointsQuery: () => ({ data: { openAI: {} } }),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    conversationByIndex: () => ({}),
  },
}));

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => () => null);
jest.mock('~/components/Stara/StaraPanel', () => () => null);

jest.mock('../useSideNavLinks', () => ({
  __esModule: true,
  default: () => [
    {
      title: 'com_sidepanel_parameters',
      label: '',
      icon: () => null,
      id: 'parameters',
    },
    {
      title: 'com_nav_setting_mcp',
      label: '',
      icon: () => null,
      id: 'mcp-builder',
    },
  ],
}));

describe('useUnifiedSidebarLinks', () => {
  it('keeps Stara after MCP in the lower tool rail', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks());

    // The rail order mirrors the requested layout: chat remains first, while
    // Stara sits after the existing tool panels near the MCP icon.
    expect(result.current.map((link) => link.id)).toEqual([
      'conversations',
      'parameters',
      'mcp-builder',
      'stara',
    ]);
  });
});
