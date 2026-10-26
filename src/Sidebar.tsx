import Icon from './Icon';
export default function Sidebar({ explorerVisible, toggleExplorer, dark, toggleTheme }: {
  explorerVisible: boolean; toggleExplorer: () => void; dark: boolean; toggleTheme: () => void;
}) {
  return <nav className="activity-bar" aria-label="侧边栏">
    <div className="brand" title="Revu">r.</div>
    <button className={'activity-button ' + (explorerVisible ? 'selected' : '')}
      title="文件管理器" aria-label="文件管理器" aria-pressed={explorerVisible} onClick={toggleExplorer}>
      <Icon name="files" size={21} />
    </button>
    <button className="activity-button theme-button" title={dark ? '切换为白色主题' : '切换为黑色主题'}
      aria-label={dark ? '切换为白色主题' : '切换为黑色主题'} onClick={toggleTheme}>
      <Icon name={dark ? 'sun' : 'moon'} size={21} />
    </button>
  </nav>;
}