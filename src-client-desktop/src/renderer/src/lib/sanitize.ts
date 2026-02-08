import DOMPurify from "dompurify"

const purify = DOMPurify(window)

purify.setConfig({
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "s",
    "del",
    "code",
    "pre",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr"
  ],
  ALLOWED_ATTR: ["href", "target", "rel"]
})

purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
})

export function sanitizeHtml(html: string): string {
  return purify.sanitize(html) as string
}
