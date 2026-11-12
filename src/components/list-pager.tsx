import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IS_MAC, useHotkey } from "@/hooks/use-hotkey"
import type { ListNeighbors } from "@/lib/list-navigation"

interface ListPagerProps {
  neighbors: ListNeighbors
  /** Called with the id to open; the page applies its unsaved-changes guard. */
  onNavigate: (id: string) => void
  previousLabel: string
  nextLabel: string
  /** Accessible description of the "3 / 120" indicator. */
  positionLabel: string
  /** Alt+←/Alt+→ are active only while true (e.g. off while the page's own modals are open). */
  hotkeysEnabled?: boolean
}

const PREV_SHORTCUT = IS_MAC ? "⌥←" : "Alt+←"
const NEXT_SHORTCUT = IS_MAC ? "⌥→" : "Alt+→"

/**
 * Previous / Next buttons for a detail page header, with a discreet position indicator.
 * Alt+ArrowLeft / Alt+ArrowRight do the same, except while typing or while a dialog is open.
 */
export function ListPager({
  neighbors,
  onNavigate,
  previousLabel,
  nextLabel,
  positionLabel,
  hotkeysEnabled = true,
}: ListPagerProps) {
  const { prevId, nextId, index, total } = neighbors

  useHotkey("ArrowLeft", () => prevId && onNavigate(prevId), {
    mod: false,
    alt: true,
    allowInInputs: false,
    enabled: hotkeysEnabled && prevId !== null,
  })
  useHotkey("ArrowRight", () => nextId && onNavigate(nextId), {
    mod: false,
    alt: true,
    allowInInputs: false,
    enabled: hotkeysEnabled && nextId !== null,
  })

  if (index === -1) return null

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        className="border-gray-600 text-gray-300 bg-transparent"
        onClick={() => prevId && onNavigate(prevId)}
        disabled={prevId === null}
        aria-label={previousLabel}
        aria-keyshortcuts="Alt+ArrowLeft"
        title={`${previousLabel} (${PREV_SHORTCUT})`}
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="min-w-[3.5rem] px-1 text-center text-xs tabular-nums text-gray-500" title={positionLabel}>
        <span aria-hidden="true">
          {index + 1} / {total}
        </span>
        <span className="sr-only">{positionLabel}</span>
      </span>
      <Button
        variant="outline"
        size="icon"
        className="border-gray-600 text-gray-300 bg-transparent"
        onClick={() => nextId && onNavigate(nextId)}
        disabled={nextId === null}
        aria-label={nextLabel}
        aria-keyshortcuts="Alt+ArrowRight"
        title={`${nextLabel} (${NEXT_SHORTCUT})`}
      >
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  )
}
