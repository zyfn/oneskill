import { ArrowClockwiseIcon, NotebookIcon, PlugsConnectedIcon, PuzzlePieceIcon, RobotIcon } from '@phosphor-icons/react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar'
import { useLocale } from '@/i18n'

export const routes = [
  { key: 'agents', labelKey: 'nav.agents', icon: RobotIcon },
  { key: 'skills', labelKey: 'nav.skills', icon: NotebookIcon },
  { key: 'plugins', labelKey: 'nav.plugins', icon: PuzzlePieceIcon },
  { key: 'mcp', labelKey: 'nav.mcp', icon: PlugsConnectedIcon },
]

export function AppSidebar({ route, onNavigate, onRefresh, refreshing }) {
  const { setOpenMobile } = useSidebar()
  const { t } = useLocale()
  const navigate = (key) => { onNavigate(key); setOpenMobile(false) }
  return (
    <Sidebar collapsible="offcanvas" variant="floating" className="notebook-sidebar">
      <SidebarHeader className="px-4 pb-3 pt-3">
        <button type="button" onClick={() => navigate('agents')} className="brand flex items-center gap-2.5 text-left" aria-label={t('brandHome')}>
          <img className="brand-mark" src="/logo.svg" alt="" width="32" height="32" />
          <span className="brand-wordmark"><span>one</span><span>skill</span></span>
        </button>
      </SidebarHeader>
      <SidebarContent className="px-3">
        <nav aria-label={t('common.workspace')}>
          <SidebarMenu className="gap-1.5">
            {routes.map(({ key, labelKey, icon: Icon }) => (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton isActive={route === key || (key === 'skills' && route === 'migrate')} onClick={() => navigate(key)} aria-current={route === key || (key === 'skills' && route === 'migrate') ? 'page' : undefined} className="notebook-nav-button">
                  <span className="nav-icon"><Icon weight="regular" size={19} aria-hidden="true" /></span>
                  <span>{t(labelKey)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter className="px-5 pb-5"><button type="button" className="sidebar-rescan" onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? t('scanning') : t('rescan')}><ArrowClockwiseIcon size={16} />{refreshing ? t('scanning') : t('rescan')}</button></SidebarFooter>
    </Sidebar>
  )
}
