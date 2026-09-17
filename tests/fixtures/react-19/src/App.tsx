import { useRef, useState } from 'react';
import { ProgressiveBlurNavbar } from './components/progressive_blur';

export default function App() {
  const target = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <main>React 19 background</main>
      <ProgressiveBlurNavbar ref={target} refreshKey={refreshKey} radius={24} transition={48}>
        <nav aria-label="Fixture navigation">React 19 navigation</nav>
      </ProgressiveBlurNavbar>
      <button onClick={() => setRefreshKey((value) => value + 1)}>Refresh</button>
    </>
  );
}
