import "prosekit/basic/style.css"
import "prosekit/extensions/placeholder/style.css"
import "prosekit/extensions/list/style.css"

import {
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  newlineInCode,
  splitBlock
} from "@prosekit/pm/commands"
import type { ProseMirrorNode } from "@prosekit/pm/model"
import { Fragment, Slice } from "@prosekit/pm/model"
import { TextSelection } from "@prosekit/pm/state"
import type { BasicExtension } from "prosekit/basic"
import { defineBasicExtension } from "prosekit/basic"
import { createEditor, union } from "prosekit/core"
import { definePasteRule } from "prosekit/extensions/paste-rule"
import { definePlaceholder } from "prosekit/extensions/placeholder"
import { defineReadonly } from "prosekit/extensions/readonly"
import { ProseKit, useDocChange, useEditor, useExtension, useKeymap } from "prosekit/solid"
import type { Accessor, Component } from "solid-js"
import { createMemo } from "solid-js"
import Toolbar from "./Toolbar"

const URL_RE = /https?:\/\/\S+[^\s.,;!?"')]/g
const MAX_CONTENT_LENGTH = 8000

/**
 * The built-in link paste rule skips plain-text pastes (`plain = true`).
 * This handles that case so pasting a bare URL from the address bar still
 * gets linkified.
 */
function definePlainTextLinkPaste() {
  return definePasteRule({
    handler({ slice, view, plain }) {
      if (!plain) return slice
      const linkType = view.state.schema.marks.link
      if (!linkType) return slice

      let changed = false
      const children: ProseMirrorNode[] = []

      slice.content.forEach((node) => {
        if (!node.isTextblock) {
          children.push(node)
          return
        }
        const inlines: ProseMirrorNode[] = []
        let blockChanged = false

        node.content.forEach((inline) => {
          if (!inline.isText || !inline.text) {
            inlines.push(inline as never)
            return
          }
          const text = inline.text
          URL_RE.lastIndex = 0
          let lastIdx = 0
          let found = false

          for (let match = URL_RE.exec(text); match; match = URL_RE.exec(text)) {
            found = true
            if (match.index > lastIdx) {
              inlines.push(view.state.schema.text(text.slice(lastIdx, match.index), inline.marks))
            }
            const mark = linkType.create({ href: match[0] })
            inlines.push(view.state.schema.text(match[0], mark.addToSet(inline.marks)) as never)
            lastIdx = URL_RE.lastIndex
          }

          if (found) {
            blockChanged = true
            if (lastIdx < text.length) {
              inlines.push(view.state.schema.text(text.slice(lastIdx), inline.marks) as never)
            }
          } else {
            inlines.push(inline as never)
          }
        })

        if (blockChanged) {
          changed = true
          children.push(node.copy(Fragment.from(inlines as never)) as never)
        } else {
          children.push(node as never)
        }
      })

      if (!changed) return slice
      return new Slice(Fragment.from(children as never), slice.openStart, slice.openEnd)
    }
  })
}

interface EditorProps {
  placeholder: string
  disabled: boolean
  allowEmptySend: boolean
  onSend: (html: string) => boolean
  onTyping: () => void
  onAttachClick?: () => void
}

const Editor: Component<EditorProps> = (props) => {
  const extension = union(
    defineBasicExtension(),
    definePlaceholder({ placeholder: props.placeholder, strategy: "doc" }),
    definePlainTextLinkPaste()
  )
  const editor = createEditor<BasicExtension>({ extension })

  return (
    <ProseKit editor={editor}>
      <EditorInner
        disabled={() => props.disabled}
        allowEmptySend={() => props.allowEmptySend}
        onSend={props.onSend}
        onTyping={props.onTyping}
        onAttachClick={props.onAttachClick}
      />
    </ProseKit>
  )
}

interface EditorInnerProps {
  disabled: Accessor<boolean>
  allowEmptySend: Accessor<boolean>
  onSend: (html: string) => boolean
  onTyping: () => void
  onAttachClick?: () => void
}

const EditorInner: Component<EditorInnerProps> = (props) => {
  const getEditor = useEditor<BasicExtension>()

  // Enter-to-send keymap
  useKeymap(() => ({
    "Shift-Enter": chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
    Enter: () => {
      const editor = getEditor()
      if (!editor.mounted) return false

      // Let Enter pass through inside code blocks and lists
      if (editor.nodes.codeBlock.isActive()) return false
      if (editor.nodes.list.isActive()) return false

      const text = editor.state.doc.textContent.trim()
      if (!text) {
        if (!props.allowEmptySend()) {
          return true
        }
        const sent = props.onSend("")
        if (sent) {
          editor.setContent("")
        }
        return true
      }

      const html = editor.getDocHTML()
      if (html.length > MAX_CONTENT_LENGTH) return true

      const sent = props.onSend(html)
      if (sent) {
        editor.setContent("")
      }
      return true
    },
    ArrowUp: (_state, _dispatch, view) => {
      if (!view) return false
      const { state } = view
      const { $head } = state.selection
      // Only inside code blocks
      if (!$head.parent.type.spec.code) return false
      // Only when at the top edge of the textblock
      if (!view.endOfTextblock("up")) return false
      // Only when the code block is the first child
      const codeBlockPos = $head.before($head.depth)
      if (state.doc.resolve(codeBlockPos).index() > 0) return false

      const paragraph = state.schema.nodes.paragraph.create()
      const tr = state.tr.insert(codeBlockPos, paragraph)
      tr.setSelection(TextSelection.create(tr.doc, codeBlockPos + 1))
      view.dispatch(tr.scrollIntoView())
      return true
    },
    ArrowDown: (_state, _dispatch, view) => {
      if (!view) return false
      const { state } = view
      const { $head } = state.selection
      if (!$head.parent.type.spec.code) return false
      if (!view.endOfTextblock("down")) return false
      const codeBlockPos = $head.before($head.depth)
      const $codeBlock = state.doc.resolve(codeBlockPos)
      if ($codeBlock.index() < $codeBlock.parent.childCount - 1) return false

      const afterPos = $head.after($head.depth)
      const paragraph = state.schema.nodes.paragraph.create()
      const tr = state.tr.insert(afterPos, paragraph)
      tr.setSelection(TextSelection.create(tr.doc, afterPos + 1))
      view.dispatch(tr.scrollIntoView())
      return true
    }
  }))

  // Typing indicator on doc changes
  useDocChange(() => {
    props.onTyping()
  })

  // Readonly when disabled
  const readonlyExt = createMemo(() => (props.disabled() ? defineReadonly() : null))
  useExtension(readonlyExt)

  return (
    <div class="prose-editor" classList={{ "opacity-50 cursor-not-allowed": props.disabled() }}>
      <Toolbar disabled={props.disabled} onAttachClick={props.onAttachClick} />
      <div
        ref={(el) => getEditor().mount(el)}
        class="bg-surface-elevated ring-1 ring-border rounded px-4 py-1.5 leading-6 text-text-primary max-h-[200px] overflow-y-auto focus-within:ring-accent transition-colors"
      />
    </div>
  )
}

export default Editor
