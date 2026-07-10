import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { MessagesSquare, Network } from 'lucide-react';
import { useUserKeyQuery } from 'librechat-data-provider/react-query';
import { getConfigDefaults, getEndpointField } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import type { NavLink } from '~/common';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import useSideNavLinks from '~/hooks/Nav/useSideNavLinks';
import StaraPanel from '~/components/Stara/StaraPanel';
import store from '~/store';

const defaultInterface = getConfigDefaults().interface;

export default function useUnifiedSidebarLinks() {
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const endpoint = conversation?.endpoint;
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();

  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, endpoint, 'type'),
    [endpoint, endpointsConfig],
  );

  const userProvidesKey = useMemo(
    () => !!(endpointsConfig?.[endpoint ?? '']?.userProvide ?? false),
    [endpointsConfig, endpoint],
  );

  const { data: keyExpiry = { expiresAt: undefined } } = useUserKeyQuery(endpoint ?? '');

  const keyProvided = useMemo(
    () => (userProvidesKey ? !!(keyExpiry.expiresAt ?? '') : true),
    [keyExpiry.expiresAt, userProvidesKey],
  );

  const sideNavLinks = useSideNavLinks({
    keyProvided,
    endpoint,
    endpointType,
    interfaceConfig,
    endpointsConfig,
    includeHidePanel: false,
  });

  const links = useMemo(() => {
    const conversationLink: NavLink = {
      title: 'com_ui_chat_history',
      label: '',
      icon: MessagesSquare,
      id: 'conversations',
      Component: ConversationsSection,
    };
    const staraLink: NavLink = {
      title: 'com_stara_control_plane',
      label: '',
      icon: Network,
      id: 'stara',
      Component: StaraPanel,
    };

    // Keep chat history as the default panel, then place Stara after the built-in
    // tool panels so the control plane lands in the lower rail near MCP.
    return [conversationLink, ...sideNavLinks, staraLink];
  }, [sideNavLinks]);

  return links;
}
