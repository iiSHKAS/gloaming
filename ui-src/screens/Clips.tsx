import {Select} from '../components/controls/Select';
import {useCallback, useEffect, useRef, useState} from 'react';
import {ReplayIcon} from '../components/LiveReplay';

import {useStore} from '../state/store';
import {useClipActions} from '../state/clipActions';
import {useImageActions} from '../state/imageActions';
import {api} from '../lib/api';
import {t} from '../lib/i18n';
import {ClipCard, type CardSelect} from '../components/ClipCard';
import {ImageCard} from '../components/ImageCard';
import {ContextMenu} from '../components/ContextMenu';
import {PlaylistModal, type PlaylistDraft} from '../components/PlaylistModal';
import {Modal} from '../components/Modal';
import {IconMore} from '../components/Icons';

export function Clips() {
  const {state, dispatch, visibleClips, visibleImages, notify, refreshPlaylists, refreshClips, refreshImages} =
    useStore();
  const {playlists, currentPlaylistId, searchQuery, recentNew} = state;

  const playlist = currentPlaylistId
    ? (playlists.find(p => p.id === currentPlaylistId) ?? null)
    : null;

  const {actions, overlays} = useClipActions();
  // A playlist holds both kinds. All Clips stays clips only, and the Images
  // section stays images only, so this is the one screen that shows a mix.
  const images = playlist ? visibleImages : [];
  const {actions: imageActions, overlays: imageOverlays} = useImageActions();
  const [sort, setSort] = useState('latest');
  const [layout, setLayout] = useState('grid');
  const sortedClips = [...visibleClips].sort((a,b) => sort === 'duration' ? (b.duration ?? 0)-(a.duration ?? 0) : (sort === 'oldest' ? 1 : -1)*(Date.parse(a.created_at)-Date.parse(b.created_at)));

  // Bulk selection. Keys are "c:slug" for clips and "i:slug" for images, in on-screen order.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const anchor = useRef<number | null>(null);
  const order = [...sortedClips.map(c => `c:${c.slug}`), ...images.map(i => `i:${i.slug}`)];
  const orderRef = useRef(order);
  orderRef.current = order;

  const leaveSelection = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
    anchor.current = null;
  }, []);

  const toggleKey = (key: string, event: React.MouseEvent) => {
    const keys = orderRef.current;
    const index = keys.indexOf(key);
    setSelectMode(true);
    setSelected(previous => {
      const next = new Set(previous);
      if (event.shiftKey && anchor.current !== null && index >= 0) {
        const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        for (let i = from; i <= to; i += 1) next.add(keys[i]);
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!event.shiftKey) anchor.current = index;
  };

  const selectFor = (key: string): CardSelect => ({
    active: selectMode,
    checked: selected.has(key),
    toggle: event => toggleKey(key, event),
  });

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select');
      if (event.key === 'Escape' && !confirmBulk) leaveSelection();
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault();
        setSelected(new Set(orderRef.current));
      } else if (event.key === 'Delete' && !typing && selected.size) setConfirmBulk(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, confirmBulk, selected.size, leaveSelection]);

  // Selection belongs to what is on screen: changing collection or search starts over.
  useEffect(() => {
    leaveSelection();
  }, [currentPlaylistId, searchQuery, leaveSelection]);

  // Items that disappear (deleted elsewhere) drop out of the selection.
  useEffect(() => {
    setSelected(previous => {
      const live = new Set(order);
      const next = new Set([...previous].filter(key => live.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [order.join('|')]);

  const deleteSelected = async () => {
    const keys = [...selected];
    setBulkBusy(true);
    const failures: string[] = [];
    // A few at a time: the daemon removes a file, its thumbnail and its sidecars for each.
    for (let i = 0; i < keys.length; i += 4) {
      const results = await Promise.allSettled(
        keys.slice(i, i + 4).map(key => (key.startsWith('c:') ? api.deleteClip(key.slice(2)) : api.deleteImage(key.slice(2)))),
      );
      results.forEach((result, offset) => {
        if (result.status === 'rejected') failures.push(keys[i + offset]);
      });
    }
    setBulkBusy(false);
    setConfirmBulk(false);
    await Promise.all([refreshClips(), refreshImages()]).catch(() => undefined);
    const done = keys.length - failures.length;
    if (failures.length) {
      notify({kind: 'error', title: `Deleted ${done} of ${keys.length}`, detail: `${failures.length} could not be deleted.`, tone: 'error', holdMs: 7000});
      setSelected(new Set(failures));
    } else {
      notify({kind: 'info', title: done === 1 ? 'Deleted 1 item' : `Deleted ${done} items`, tone: 'accent', holdMs: 3500});
      leaveSelection();
    }
  };

  const [editingPlaylist, setEditingPlaylist] = useState<'new' | 'edit' | null>(null);
  const [confirmPlaylistDelete, setConfirmPlaylistDelete] = useState(false);
  const [playlistMenu, setPlaylistMenu] = useState<{x: number; y: number} | null>(null);

  const fail = (title: string) => (err: Error) =>
    notify({kind: 'error', title, detail: err.message, tone: 'error', holdMs: 7000});

  const submitPlaylist = async (draft: PlaylistDraft) => {
    if (editingPlaylist === 'edit' && playlist) {
      const result = await api.updatePlaylist(playlist.id, draft);
      if (result.ok === false) throw new Error(result.error || t('clips.errUpdatePlaylist'));
      await refreshPlaylists();
      notify({kind: 'info', title: t('clips.playlistUpdated'), tone: 'accent', holdMs: 3000});
    } else {
      const result = await api.createPlaylist(draft);
      if (result.ok === false) throw new Error(result.error || t('clips.errCreatePlaylist'));
      await refreshPlaylists();
      dispatch({type: 'setView', view: 'clips', playlistId: result.playlist.id});
      notify({
        kind: 'info',
        title: t('clips.playlistCreated', {name: draft.name}),
        tone: 'accent',
        holdMs: 3500,
      });
    }
    setEditingPlaylist(null);
  };

  const title = playlist ? playlist.name : 'Library';
  const count = visibleClips.length;
  const query = searchQuery.trim();
  const subtitle = query
    ? t('clips.countMatches', {count, query})
    : t('clips.countClips', {count});
  const empty = count === 0 && images.length === 0;
  const isAuto = playlist?.kind === 'auto';

  return (
    <div className="clips clips-library" data-select-mode={selectMode || undefined}>
      <header className="clips-head">
        <div className="clips-title">
          <h1>
            {playlist?.emoji ? <span className="clips-emoji">{playlist.emoji}</span> : null}
            {title}
          </h1>
          <span className="library-result-count" role="status">{subtitle}</span>
        </div>

        <div className="clips-tools">
          {playlist ? (
            <button
              type="button"
              className="btn btn-quiet btn-icon-only"
              title={t('clips.playlistOptions')}
              aria-label={t('clips.playlistOptions')}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                setPlaylistMenu({x: r.right - 200, y: r.bottom + 6});
              }}>
              <IconMore size={16} />
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={() => setEditingPlaylist('new')}>
            {t('clips.newPlaylist')}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            aria-pressed={selectMode}
            disabled={empty}
            onClick={() => (selectMode ? leaveSelection() : setSelectMode(true))}>
            {selectMode ? 'Cancel selection' : 'Select'}
          </button>
          <button className="btn btn-quiet" onClick={()=>dispatch({type:'setView',view:'images'})}>Images</button>
        </div>
      </header>

      <div className="studio-library-tools">
        <div className="library-filters">
        <label className="library-search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" aria-label="Search captures" placeholder="Search clips…" value={searchQuery} onChange={e=>dispatch({type:'setSearch',query:e.target.value})}/></label>
        <Select label="Collection" value={currentPlaylistId??''} onChange={value=>dispatch({type:'setView',view:'clips',playlistId:value||null})} options={[["", "All clips"],...playlists.map(p=>[p.id,p.name] as [string,string])]}/>
        </div>
        <div className="library-controls">
          <Select label="Sort clips" value={sort} onChange={setSort} options={[["latest","Newest first"],["oldest","Oldest first"],["duration","Longest first"]]}/>
          <div className="library-view-toggle" role="group" aria-label="Library layout">
            <button aria-label="Grid view" aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="1" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="5" height="5" rx="1"/></svg></button>
            <button aria-label="List view" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor"><path d="M1 3h3m3 0h8M1 8h3m3 0h8M1 13h3m3 0h8"/></svg></button>
          </div>
        </div>
      </div>
      {empty ? (
        <div className="library-empty"><ReplayIcon name="cut"/><h3>{query ? "No matching moments" : "Your highlights start here"}</h3><p>
          {query
            ? t('clips.emptySearch', {query})
            : playlist
              ? t('clips.emptyPlaylist')
              : 'Your saved clips will appear here. Browse, organize and revisit your moments.' }
        </p></div>
      ) : null}

      {count > 0 ? (
        <div className={`clip-grid library-cards ${layout === 'list' ? 'library-list' : ''}`}>
          {sortedClips.map(clip => (
            <ClipCard
              key={clip.slug}
              clip={clip}
              draggable
              isNew={recentNew.includes(clip.slug)}
              actions={actions}
              select={selectFor(`c:${clip.slug}`)}
            />
          ))}
        </div>
      ) : null}

      {images.length > 0 ? (
        <>
          <h2 className="clips-section">{t('clips.imagesHeading', {count: images.length})}</h2>
          <div className="clip-grid">
            {images.map(image => (
              <ImageCard key={image.slug} image={image} draggable actions={imageActions} select={selectFor(`i:${image.slug}`)} />
            ))}
          </div>
        </>
      ) : null}

      {playlistMenu && playlist ? (
        <ContextMenu
          at={playlistMenu}
          heading={playlist.name}
          emptyLabel={t('common.noActions')}
          onClose={() => setPlaylistMenu(null)}
          items={[
            {
              id: 'edit',
              label: t('clips.editPlaylist'),
              onSelect: () => setEditingPlaylist('edit'),
            },
            {
              id: 'delete',
              label: t('clips.deletePlaylist'),
              danger: true,
              onSelect: () => setConfirmPlaylistDelete(true),
            },
          ]}
        />
      ) : null}

      <PlaylistModal
        open={editingPlaylist !== null}
        editing={editingPlaylist === 'edit' ? playlist : null}
        onClose={() => setEditingPlaylist(null)}
        onSubmit={submitPlaylist}
      />

      <Modal
        open={confirmPlaylistDelete}
        title={t('clips.confirmDeleteTitle')}
        onClose={() => setConfirmPlaylistDelete(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setConfirmPlaylistDelete(false)}>
              {t('common.keepIt')}
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              onClick={() => {
                setConfirmPlaylistDelete(false);
                if (!playlist) return;
                void api
                  .deletePlaylist(playlist.id)
                  .then(async () => {
                    await refreshPlaylists();
                    dispatch({type: 'setView', view: 'clips', playlistId: null});
                    notify({
                      kind: 'info',
                      title: t('clips.playlistDeleted'),
                      tone: 'neutral',
                      holdMs: 3000,
                    });
                  })
                  .catch(fail(t('clips.errDeletePlaylist')));
              }}>
              {t('common.delete')}
            </button>
          </>
        }>
        <p>
          {t('clips.confirmDeleteBody')}
          {isAuto ? t('clips.confirmDeleteAuto') : ''}
        </p>
      </Modal>

      {selectMode ? (
        <div className="select-bar" role="toolbar" aria-label="Selected items">
          <span className="select-bar-count" role="status">
            {selected.size === 0 ? 'Pick items' : selected.size === 1 ? '1 selected' : `${selected.size} selected`}
          </span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected(new Set(order))} disabled={selected.size === order.length}>
            Select all
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
            Clear
          </button>
          <button type="button" className="btn btn-danger-solid btn-sm" onClick={() => setConfirmBulk(true)} disabled={selected.size === 0}>
            Delete{selected.size ? ` ${selected.size}` : ''}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={leaveSelection}>
            Done
          </button>
        </div>
      ) : null}

      <Modal
        open={confirmBulk}
        title={selected.size === 1 ? 'Delete 1 item?' : `Delete ${selected.size} items?`}
        onClose={() => !bulkBusy && setConfirmBulk(false)}
        footer={
          <>
            <button type="button" className="btn btn-quiet" disabled={bulkBusy} onClick={() => setConfirmBulk(false)}>
              {t('common.keepIt')}
            </button>
            <button type="button" className="btn btn-danger-solid" disabled={bulkBusy} onClick={() => void deleteSelected()}>
              {bulkBusy ? 'Deleting…' : t('common.delete')}
            </button>
          </>
        }>
        <p>These files are removed from your disk and cannot be restored.</p>
      </Modal>

      {overlays}
      {imageOverlays}
    </div>
  );
}
