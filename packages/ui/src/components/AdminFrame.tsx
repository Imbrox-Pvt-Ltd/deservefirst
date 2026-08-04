'use client';

/**
 * UI · components/AdminFrame.tsx
 * The admin chrome: top bar, left navigation, content pane. Modelled directly on
 * the captured reference admin — a dark full-width bar with the brand at the
 * left, a centred search, and the account cluster at the right; below it a
 * light navigation rail whose sub-items appear beneath the open section.
 *
 * This is deliberately not built from the design system's Frame/TopBar. Those
 * render a light bar with the search inside the navigation column, which is a
 * different layout, not a different theme — no amount of token overriding gets
 * from one to the other. Everything INSIDE the content pane is still design
 * system components; only the chrome is drawn here, and it is drawn once so no
 * screen can drift from it.
 * Layer: ui.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon, isIconName } from './icons';
import type { NavSection } from '../navigation';

export interface AdminFrameStore {
  readonly handle: string;
  readonly name: string;
}

export interface AdminFrameProps {
  readonly brandName: string;
  /** Small pill beside the wordmark — the reference shows its release train. */
  readonly release?: string;
  readonly sections: readonly NavSection[];
  readonly settingsPath: string;
  readonly settingsSelected: boolean;
  readonly pathname: string;
  readonly store: AdminFrameStore;
  readonly stores: readonly AdminFrameStore[];
  readonly notificationCount?: number;
  readonly searchTerm?: string;
  readonly onNavigate: (path: string) => void;
  readonly onSearch: (term: string) => void;
  readonly onSwitchStore: (handle: string) => void;
  readonly onSignOut: () => void;
  readonly children: ReactNode;
}

/** Two letters, as the reference renders the store avatar. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  // "My Store 3" → "MS3" in the reference: first letters, then a trailing digit
  // if the name ends in one. Names are merchant-chosen and often numbered.
  const letters = words.map((word) => word[0]!).join('').toUpperCase();
  return letters.slice(0, 3);
}

export function AdminFrame({
  brandName,
  release,
  sections,
  settingsPath,
  settingsSelected,
  pathname,
  store,
  stores,
  notificationCount = 0,
  searchTerm = '',
  onNavigate,
  onSearch,
  onSwitchStore,
  onSignOut,
  children,
}: AdminFrameProps) {
  const [storeMenuOpen, setStoreMenuOpen] = useState(false);
  const [term, setTerm] = useState(searchTerm);
  const searchRef = useRef<HTMLInputElement>(null);

  // The reference binds ⌘K / Ctrl-K to the search field, and the bar advertises
  // the shortcut — showing a shortcut that does nothing is worse than showing none.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Reflects an externally-changed term (back/forward, or a link carrying a
  // query) without fighting the user while they type.
  useEffect(() => setTerm(searchTerm), [searchTerm]);

  const isSelected = useCallback((path: string) => pathname === stripQuery(path), [pathname]);

  const storeRoot = `/store/${store.handle}`;

  const isWithin = useCallback(
    (path: string) => {
      const base = stripQuery(path);
      if (pathname === base) return true;
      // Home is the store root, which prefixes every other path — a prefix test
      // would light it up on every screen in the admin.
      if (base === storeRoot) return false;
      return pathname.startsWith(`${base}/`);
    },
    [pathname, storeRoot],
  );

  return (
    <div className="df-shell">
      <header className="df-topbar">
        <div className="df-topbar__brand">
          <button
            type="button"
            className="df-brand"
            onClick={() => onNavigate(`/store/${store.handle}`)}
          >
            <span className="df-brand__mark" aria-hidden="true">
              {brandName.slice(0, 1).toUpperCase()}
            </span>
            <span className="df-brand__name">{brandName}</span>
          </button>
          {release ? <span className="df-brand__release">{release}</span> : null}
        </div>

        <div className="df-topbar__center">
          <form
            className="df-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(term);
            }}
          >
            <span className="df-search__icon">
              <Icon name="search" size={16} />
            </span>
            <input
              ref={searchRef}
              className="df-search__input"
              type="search"
              value={term}
              placeholder="Search"
              aria-label="Search"
              onChange={(event) => setTerm(event.target.value)}
            />
            <span className="df-search__shortcut" aria-hidden="true">
              <kbd>⌘</kbd>
              <kbd>K</kbd>
            </span>
          </form>

          <button type="button" className="df-topbar__pill">
            <Icon name="view" size={16} />
            <span>View as</span>
          </button>
        </div>

        <div className="df-topbar__account">
          <button type="button" className="df-iconbutton" aria-label="Assistant">
            <Icon name="assistant" size={20} />
          </button>

          <button type="button" className="df-iconbutton" aria-label="Notifications">
            <Icon name="bell" size={20} />
            {notificationCount > 0 ? (
              <span className="df-badge" aria-label={`${notificationCount} unread`}>
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            ) : null}
          </button>

          <div className="df-storemenu">
            <button
              type="button"
              className="df-store"
              aria-haspopup="menu"
              aria-expanded={storeMenuOpen}
              onClick={() => setStoreMenuOpen((open) => !open)}
            >
              <span className="df-store__avatar">{initialsOf(store.name)}</span>
              <span className="df-store__name">{store.name}</span>
            </button>

            {storeMenuOpen ? (
              <>
                <div className="df-storemenu__scrim" onClick={() => setStoreMenuOpen(false)} />
                <div className="df-storemenu__list" role="menu">
                  {stores.map((entry) => (
                    <button
                      key={entry.handle}
                      type="button"
                      role="menuitem"
                      className="df-storemenu__item"
                      aria-current={entry.handle === store.handle}
                      onClick={() => {
                        setStoreMenuOpen(false);
                        onSwitchStore(entry.handle);
                      }}
                    >
                      <span className="df-store__avatar df-store__avatar--sm">
                        {initialsOf(entry.name)}
                      </span>
                      {entry.name}
                    </button>
                  ))}
                  <div className="df-storemenu__divider" />
                  <button
                    type="button"
                    role="menuitem"
                    className="df-storemenu__item"
                    onClick={() => {
                      setStoreMenuOpen(false);
                      onNavigate('/');
                    }}
                  >
                    All stores
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="df-storemenu__item"
                    onClick={() => {
                      setStoreMenuOpen(false);
                      onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="df-body">
        <nav className="df-nav" aria-label="Main">
          <div className="df-nav__scroll">
            {sections.map((section) => (
              <div className="df-nav__section" key={section.id}>
                {section.label ? (
                  <button type="button" className="df-nav__title">
                    {section.label}
                    <Icon name="chevron-right" size={14} />
                  </button>
                ) : null}

                {section.items.map((item) => {
                  const open = isWithin(item.path) || (item.children ?? []).some((c) => isWithin(c.path));
                  const selected = isSelected(item.path);

                  return (
                    <div key={item.id}>
                      <NavRow
                        label={item.label}
                        icon={item.icon}
                        selected={selected}
                        // The open section stays tinted while a child is
                        // selected, so the merchant can see where they are in
                        // the hierarchy without the parent stealing the
                        // selected state.
                        open={open && !selected}
                        unavailable={item.unavailable}
                        onClick={() => onNavigate(item.path)}
                      />

                      {open && item.children && item.children.length > 0 ? (
                        <div className="df-nav__children">
                          {item.children.map((child) => (
                            <NavRow
                              key={child.id}
                              label={child.label}
                              child
                              selected={isWithin(child.path)}
                              unavailable={child.unavailable}
                              onClick={() => onNavigate(child.path)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {section.id === 'apps' ? (
                  <NavRow label="Add" icon="add" muted onClick={() => onNavigate('/')} />
                ) : null}
              </div>
            ))}
          </div>

          <div className="df-nav__footer">
            <NavRow
              label="Settings"
              icon="settings"
              selected={settingsSelected}
              onClick={() => onNavigate(settingsPath)}
            />
          </div>
        </nav>

        <main className="df-main">{children}</main>
      </div>
    </div>
  );
}

function NavRow({
  label,
  icon,
  selected = false,
  open = false,
  child = false,
  muted = false,
  unavailable = false,
  onClick,
}: {
  label: string;
  icon?: string;
  selected?: boolean;
  open?: boolean;
  child?: boolean;
  muted?: boolean;
  unavailable?: boolean;
  onClick: () => void;
}) {
  const classes = [
    'df-navrow',
    child ? 'df-navrow--child' : '',
    selected ? 'df-navrow--selected' : '',
    open ? 'df-navrow--open' : '',
    muted ? 'df-navrow--muted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} onClick={onClick} aria-current={selected ? 'page' : undefined}>
      {child ? (
        // The connector the reference draws from the open parent to the
        // selected child. Only the selected child gets it — on every child it
        // would read as decoration rather than as "you are here".
        <span className="df-navrow__connector" aria-hidden="true">
          {selected ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 2v7a3 3 0 0 0 3 3h5m0 0-2.5-2.5M12 12l-2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
      ) : (
        <span className="df-navrow__icon">{isIconName(icon) ? <Icon name={icon} /> : null}</span>
      )}
      <span className="df-navrow__label">{label}</span>
      {unavailable ? <span className="df-navrow__dot" aria-label="Not in this install" /> : null}
    </button>
  );
}

/** Nav paths may carry a default query (`?location_id=…`); match on the path. */
function stripQuery(path: string): string {
  const at = path.indexOf('?');
  return at === -1 ? path : path.slice(0, at);
}
