/** The GLOAMING wordmark: used in the sidebar, the About hero and the boot cover. */
export function Wordmark({height = 20, className}: {height?: number; className?: string}) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'} style={{fontSize: height}}>
      GLOAMING
    </span>
  );
}
