import { forwardRef } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { ContextMenuActionItem } from './contextMenuTypes';

interface ContextMenuItemProps {
  item: ContextMenuActionItem;
  active: boolean;
  submenuOpen: boolean;
  onActivate: () => void;
  onHover: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
}

const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem({ item, active, submenuOpen, onActivate, onHover, onKeyDown }, ref) {
    const Icon = item.icon;
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        aria-disabled={item.disabled || undefined}
        aria-haspopup={item.items?.length ? 'menu' : undefined}
        aria-expanded={item.items?.length ? submenuOpen : undefined}
        disabled={item.disabled}
        tabIndex={active ? 0 : -1}
        className={`nammu-context-item ${active ? 'is-active' : ''} ${item.danger ? 'is-danger' : ''}`}
        onClick={onActivate}
        onMouseEnter={onHover}
        onFocus={onHover}
        onKeyDown={onKeyDown}
      >
        <span className="nammu-context-check">{item.checked ? <Check size={10} /> : null}</span>
        <span className="nammu-context-icon">
          {Icon ? <Icon size={12} strokeWidth={1.45} /> : null}
        </span>
        <span className="nammu-context-label">{item.label}</span>
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
        {item.items?.length ? (
          <ChevronRight className="nammu-context-arrow" size={10} />
        ) : (
          <span className="nammu-context-arrow" />
        )}
      </button>
    );
  },
);

export default ContextMenuItem;
