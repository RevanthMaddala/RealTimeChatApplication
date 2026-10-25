import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import ChatPanel from './ChatPanel.jsx';

// On narrow screens only one pane is visible at a time; `view` decides which.
// On desktop both are always shown and `view` is ignored by the CSS.
export default function ChatLayout() {
  const [view, setView] = useState('list');
  return (
    <div className="layout" data-view={view}>
      <Sidebar onNavigate={() => setView('chat')} />
      <ChatPanel onBack={() => setView('list')} />
    </div>
  );
}
