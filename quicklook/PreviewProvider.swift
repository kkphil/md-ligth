// Quick Look preview for Markdown files: press space on a .md file in Finder
// and it shows formatted, the way md-light renders it.
//
// The Markdown is turned into HTML by render.js (built from quicklook/render.ts)
// running in JavaScriptCore; images next to the document are passed along as
// attachments so the preview can show them.

import Cocoa
import JavaScriptCore
import Quartz
import UniformTypeIdentifiers

/// Collects image files referenced by the document while it is rendered.
private final class Attachments {
    var items: [String: QLPreviewReplyAttachment] = [:]
}

@objc(MDLPreviewProvider)
final class PreviewProvider: QLPreviewProvider, QLPreviewingController {

    func providePreview(for request: QLFilePreviewRequest) async throws -> QLPreviewReply {
        let fileURL = request.fileURL
        let data = try Data(contentsOf: fileURL)
        let markdown = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)

        let bundle = Bundle(for: PreviewProvider.self)
        let css = bundle.url(forResource: "preview", withExtension: "css")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""

        let attachments = Attachments()
        let body = render(markdown, baseDirectory: fileURL.deletingLastPathComponent(), bundle: bundle, attachments: attachments)
            ?? "<pre>\(escapeHTML(markdown))</pre>"

        let title = escapeHTML(fileURL.deletingPathExtension().lastPathComponent)
        let html = """
            <!doctype html>
            <html><head><meta charset="utf-8"><title>\(title)</title><style>\(css)</style></head>
            <body><article class="markdown-body">\(body)</article></body></html>
            """

        return QLPreviewReply(dataOfContentType: .html, contentSize: CGSize(width: 860, height: 1100)) { reply in
            reply.stringEncoding = .utf8
            reply.attachments = attachments.items
            return Data(html.utf8)
        }
    }

    /// Runs render.js; nil if the script is missing or throws.
    private func render(_ markdown: String, baseDirectory: URL, bundle: Bundle, attachments: Attachments) -> String? {
        guard let scriptURL = bundle.url(forResource: "render", withExtension: "js"),
              let script = try? String(contentsOf: scriptURL, encoding: .utf8),
              let context = JSContext() else { return nil }

        var failed = false
        context.exceptionHandler = { _, exception in
            failed = true
            NSLog("md-light Quick Look: %@", exception?.toString() ?? "unknown error")
        }

        // Local images become attachments ("cid:…"); web and data URLs stay as they are.
        let resolveImage: @convention(block) (String) -> String = { src in
            if src.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*:", options: .regularExpression) != nil { return src }
            let path = src.removingPercentEncoding ?? src
            let url = path.hasPrefix("/")
                ? URL(fileURLWithPath: path)
                : baseDirectory.appendingPathComponent(path).standardizedFileURL
            guard let bytes = try? Data(contentsOf: url) else { return src }
            let id = "image\(attachments.items.count)"
            let type = UTType(filenameExtension: url.pathExtension) ?? .image
            attachments.items[id] = QLPreviewReplyAttachment(data: bytes, contentType: type)
            return "cid:\(id)"
        }
        context.setObject(resolveImage, forKeyedSubscript: "mdlResolveImage" as NSString)

        context.evaluateScript(script)
        guard !failed,
              let result = context.objectForKeyedSubscript("mdlRender")?.call(withArguments: [markdown]),
              !failed, result.isString else { return nil }
        return result.toString()
    }
}

private func escapeHTML(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
}
