// widgets/file-upload.tsx — a browser file picker that reads each chosen file to
// a data URL and writes it to a `param`.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm({ param, defaultValue })`, styles
// via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag.
//
// Prop contract is a strict SUBSET of the application's file-upload
// (application/client/src/udfrun/json-ui/components/file-upload.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props — param (optional), label, accept,
// multiple, maxSizeMb. The universal `css` is read off `element.props.style`.
//
// IMPORTANT app-parity note — this is a CONFIG-compat / behaviour SUBSET, not a
// render-fidelity mapping. The application uploads to an S3/fd/gs destination
// (destinationPath, access checks, progress, sourceMode=picker|content) and
// broadcasts a JSON array of { path, fileName }. openfused has NO storage layer
// and imports ONLY the SDK + local primitives, so it instead reads files
// in-browser via FileReader.readAsDataURL and broadcasts the data URL(s)
// directly: a single data URL string for one file, or a JSON-stringified array
// of data URL strings when `multiple`. App-only props (destinationPath,
// sourceMode, contentParam, autoUpload, uploadLabel, disabled, readOnly) are
// intentionally omitted; a pasted app config that sets them is ignored here.
//
// A `maxSizeMb` guard (default 5) skips files over the limit and surfaces a
// small message — it never throws. FileReader errors are caught and shown.

import React from "react";
import { z } from "zod";
import {
  useFusedParamWithForm,
  parseStyle,
  defineComponent,
  type ComponentRenderProps,
} from "@fusedio/widget-sdk";

import { UNIVERSAL_PROPS } from "./_universal";
import type { ComponentDef } from "./types";
import { Field } from "../components/field";

// ----------------------------------------------------------------- props schema
// A strict subset of the application's FileUploadPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`.
export const fileUploadProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with, or form field name if inside a Form component. Broadcasts a data URL string (single file) or a JSON-stringified array of data URLs (multiple).",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the file upload widget."),
    accept: z
      .string()
      .optional()
      .describe(
        'Optional accept attribute for the browser file picker (e.g. "image/*" or ".csv,.json").',
      ),
    multiple: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow selecting multiple files."),
    maxSizeMb: z
      .number()
      .positive()
      .optional()
      .default(5)
      .describe(
        "Maximum size per file in megabytes. Files over the limit are skipped with a message (never throws).",
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type FileUploadProps = z.infer<typeof fileUploadProps>;

// Read one File to a data URL string; resolves null on read error.
function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// -------------------------------------------------------------------- component
function FileUpload({ element }: ComponentRenderProps<FileUploadProps>) {
  const { param, label, accept, multiple, maxSizeMb } = element.props;
  const style = (element.props as { style?: string }).style;

  // Form-ready param binding: identical API to useFusedParam, defers broadcast
  // inside a Form. debounceMs 0 — selecting files is a deliberate single action.
  // broadcastDefaultValue false — never seed an empty value onto the canvas.
  const { setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: "",
    broadcastDefaultValue: false,
    debounceMs: 0,
  });

  const [fileNames, setFileNames] = React.useState<string[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);

  const id = `ofw-file-${param ?? "local"}`;
  const limitBytes = (maxSizeMb ?? 5) * 1024 * 1024;

  const handleChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;

      const all = Array.from(fileList);
      const tooLarge = all.filter((f) => f.size > limitBytes);
      const within = all.filter((f) => f.size <= limitBytes);

      // Reset the native input so re-selecting the same file fires onChange.
      e.target.value = "";

      if (within.length === 0) {
        setFileNames([]);
        setMessage(
          `All files exceed the ${maxSizeMb ?? 5} MB limit and were skipped.`,
        );
        return;
      }

      const dataUrls = await Promise.all(within.map(readFileAsDataUrl));
      const ok: { name: string; url: string }[] = [];
      within.forEach((f, i) => {
        const url = dataUrls[i];
        if (url) ok.push({ name: f.name, url });
      });

      if (ok.length === 0) {
        setFileNames([]);
        setMessage("Could not read the selected file(s).");
        return;
      }

      setFileNames(ok.map((o) => o.name));

      const skipped = tooLarge.length + (within.length - ok.length);
      setMessage(
        skipped > 0
          ? `${skipped} file(s) skipped (over ${
              maxSizeMb ?? 5
            } MB or unreadable).`
          : null,
      );

      if (multiple) {
        setValue(JSON.stringify(ok.map((o) => o.url)));
      } else {
        setValue(ok[0].url);
      }
    },
    [limitBytes, maxSizeMb, multiple, setValue],
  );

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          id={id}
          className="ofw-input"
          type="file"
          accept={accept}
          multiple={multiple ?? false}
          onChange={handleChange}
        />
        {fileNames.length > 0 ? (
          <div style={{ fontSize: 13, color: "#888" }}>
            {fileNames.length === 1
              ? fileNames[0]
              : `${fileNames.length} files selected`}
          </div>
        ) : null}
        {message ? (
          <div className="ofw-error-msg" role="alert">
            {message}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: FileUpload,
    props: fileUploadProps,
    description:
      "File picker that reads selected files to data URLs and writes them to a param (single data URL, or JSON array when multiple).",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
