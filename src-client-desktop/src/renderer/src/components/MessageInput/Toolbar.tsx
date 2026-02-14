import type { BasicExtension } from "prosekit/basic"
import { useEditor } from "prosekit/solid"
import {
  TbOutlineBlockquote,
  TbOutlineBold,
  TbOutlineCode,
  TbOutlineItalic,
  TbOutlineLink,
  TbOutlineList,
  TbOutlineListNumbers,
  TbOutlinePlus,
  TbOutlineSourceCode,
  TbOutlineStrikethrough
} from "solid-icons/tb"
import type { Accessor, Component, JSX } from "solid-js"
import { createSignal, onCleanup, onMount, Show } from "solid-js"

interface ToolbarProps {
  disabled: Accessor<boolean>
  onAttachClick?: () => void
}

const Toolbar: Component<ToolbarProps> = (props) => {
  const getEditor = useEditor<BasicExtension>({ update: true })

  const handleCodeBlock = () => {
    const editor = getEditor()
    if (editor.nodes.codeBlock.isActive()) {
      const { state } = editor
      const { $from } = state.selection
      const codeBlockNode = $from.node($from.depth)
      const pos = $from.before($from.depth)
      const { paragraph } = state.schema.nodes
      const lines = codeBlockNode.textContent.split("\n")
      const paras = lines.map((line) =>
        paragraph.create({}, line ? state.schema.text(line) : undefined)
      )
      const tr = state.tr.replaceWith(pos, pos + codeBlockNode.nodeSize, paras)
      editor.view.dispatch(tr)
      return
    }
    const { state } = editor
    const { $from, $to } = state.selection
    const blockStart = $from.before($from.depth)
    const blockEnd = $to.after($to.depth)
    const lines: string[] = []
    state.doc.nodesBetween(blockStart, blockEnd, (node): boolean => {
      if (node.isTextblock) {
        lines.push(node.textContent)
        return false
      }
      return true
    })
    const text = lines.join("\n")
    const { codeBlock } = state.schema.nodes
    const node = codeBlock.create({}, text ? state.schema.text(text) : undefined)
    const tr = state.tr.replaceWith(blockStart, blockEnd, node)
    editor.view.dispatch(tr)
  }

  const [linkPopover, setLinkPopover] = createSignal(false)

  const handleLink = () => {
    const editor = getEditor()
    if (editor.marks.link.isActive()) {
      editor.commands.expandLink()
      editor.commands.removeLink()
      return
    }
    setLinkPopover(!linkPopover())
  }

  const submitLink = (href: string) => {
    setLinkPopover(false)
    const url = href.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) return
    const editor = getEditor()
    editor.commands.addLink({ href: url })
    editor.focus()
  }

  return (
    <Show when={!props.disabled()}>
      <div class="flex items-center gap-0.5 px-1 py-1">
        <ToolbarButton
          active={() => false}
          disabled={() => props.disabled() || !props.onAttachClick}
          onClick={() => props.onAttachClick?.()}
          title="Attach Files"
        >
          <TbOutlinePlus size={16} />
        </ToolbarButton>

        <div class="w-px h-4 bg-border mx-1" />

        <ToolbarButton
          active={() => getEditor().marks.bold.isActive()}
          disabled={() => !getEditor().commands.toggleBold.canExec()}
          onClick={() => getEditor().commands.toggleBold()}
          title="Bold (Ctrl+B)"
        >
          <TbOutlineBold size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().marks.italic.isActive()}
          disabled={() => !getEditor().commands.toggleItalic.canExec()}
          onClick={() => getEditor().commands.toggleItalic()}
          title="Italic (Ctrl+I)"
        >
          <TbOutlineItalic size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().marks.strike.isActive()}
          disabled={() => !getEditor().commands.toggleStrike.canExec()}
          onClick={() => getEditor().commands.toggleStrike()}
          title="Strikethrough"
        >
          <TbOutlineStrikethrough size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().marks.code.isActive()}
          disabled={() => !getEditor().commands.toggleCode.canExec()}
          onClick={() => getEditor().commands.toggleCode()}
          title="Inline Code"
        >
          <TbOutlineCode size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().nodes.codeBlock.isActive()}
          disabled={() => !getEditor().commands.toggleCodeBlock.canExec()}
          onClick={handleCodeBlock}
          title="Code Block"
        >
          <TbOutlineSourceCode size={16} />
        </ToolbarButton>

        <div class="w-px h-4 bg-border mx-1" />

        <ToolbarButton
          active={() => getEditor().nodes.list.isActive({ kind: "bullet" })}
          disabled={() => !getEditor().commands.toggleList.canExec({ kind: "bullet" })}
          onClick={() => getEditor().commands.toggleList({ kind: "bullet" })}
          title="Bullet List"
        >
          <TbOutlineList size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().nodes.list.isActive({ kind: "ordered" })}
          disabled={() => !getEditor().commands.toggleList.canExec({ kind: "ordered" })}
          onClick={() => getEditor().commands.toggleList({ kind: "ordered" })}
          title="Ordered List"
        >
          <TbOutlineListNumbers size={16} />
        </ToolbarButton>
        <ToolbarButton
          active={() => getEditor().nodes.blockquote.isActive()}
          disabled={() => !getEditor().commands.toggleBlockquote.canExec()}
          onClick={() => getEditor().commands.toggleBlockquote()}
          title="Blockquote"
        >
          <TbOutlineBlockquote size={16} />
        </ToolbarButton>

        <div class="w-px h-4 bg-border mx-1" />

        <div class="relative flex">
          <ToolbarButton
            active={() => getEditor().marks.link.isActive()}
            disabled={() => getEditor().state.selection.empty}
            onClick={handleLink}
            title="Link"
          >
            <TbOutlineLink size={16} />
          </ToolbarButton>
          <Show when={linkPopover()}>
            <LinkPopover onSubmit={submitLink} onClose={() => setLinkPopover(false)} />
          </Show>
        </div>
      </div>
    </Show>
  )
}

interface LinkPopoverProps {
  onSubmit: (href: string) => void
  onClose: () => void
}

const LinkPopover: Component<LinkPopoverProps> = (props) => {
  let containerRef!: HTMLDivElement
  let inputRef!: HTMLInputElement

  const handleClickOutside = (e: MouseEvent) => {
    if (!containerRef.contains(e.target as Node)) {
      props.onClose()
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside)
    inputRef.focus()
  })
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside))

  return (
    <div
      ref={containerRef}
      class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-surface border border-border rounded-lg shadow-xl p-2 flex gap-2"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          props.onSubmit(inputRef.value)
        }}
        class="flex gap-2"
      >
        <input
          ref={inputRef}
          class="input text-sm px-2 py-1 w-48"
          placeholder="https://..."
          onKeyDown={(e) => {
            if (e.key === "Escape") props.onClose()
          }}
        />
        <button
          type="submit"
          class="px-2 py-1 text-sm rounded bg-accent text-white hover:bg-accent/80 transition-colors"
        >
          Add
        </button>
      </form>
    </div>
  )
}

interface ToolbarButtonProps {
  active: Accessor<boolean>
  disabled: Accessor<boolean>
  onClick: () => void
  title: string
  children: JSX.Element
}

const ToolbarButton: Component<ToolbarButtonProps> = (props) => (
  <button
    type="button"
    title={props.title}
    disabled={props.disabled()}
    onMouseDown={(e) => {
      e.preventDefault()
      if (!props.disabled()) props.onClick()
    }}
    class="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    classList={{ "!text-accent !bg-accent/10": props.active() }}
  >
    {props.children}
  </button>
)

export default Toolbar
