// widgets/camera-input.tsx — captures a still frame from the device camera and
// writes it to a `param` as a JPEG data URL string.
//
// A fan-out INPUT component. Authored ONLY against `@fusedio/widget-sdk`: reads
// `element.props`, declares real-zod props `.extend(UNIVERSAL_PROPS.shape)`,
// binds the param via `useFusedParamWithForm({ param, defaultValue })`, styles
// via `parseStyle(element.props.style)`, and default-exports
// `defineComponent({...})` PLUS the `writesParam: true` flag.
//
// Prop contract is a strict SUBSET of the application's camera-input
// (application/client/src/udfrun/json-ui/components/camera-input.tsx): identical
// prop NAMES/TYPES/SEMANTICS, fewer props — param (optional), label, facingMode.
// The universal `css` is read off `element.props.style` (the universal
// `css -> style` rename lands in ./_universal.ts globally; this file must NOT
// redeclare `style`).
//
// The host-state seam is `useFusedParamWithForm`, the form-ready variant of
// `useFusedParam`: identical API, but inside a built-in Form it defers the
// broadcast and mirrors the live value into the form store; outside a form it is
// exactly `useFusedParam` (two-way canvas binding). The captured frame is stored
// as a `canvas.toDataURL("image/jpeg")` string.
//
// NOT reproduced (app-only machinery, intentionally out of openfused scope): the
// file-picker fallback (`Send photo`), imageFormat/quality knobs, disabled/
// readOnly, and the rich retake/clear button matrix. openfused keeps the
// browser-native getUserMedia → capture path only, and degrades gracefully when
// no camera is available (a message, never a throw). The media stream is always
// stopped on unmount.

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
// A strict subset of the application's CameraInputPropsSchema: identical
// names/types/semantics, plus the universal `style` prop folded in via
// `.extend(UNIVERSAL_PROPS.shape)`.
export const cameraInputProps = z
  .object({
    param: z
      .string()
      .optional()
      .describe(
        "The canvas parameter name to sync with, or form field name if inside a Form component. Captured photos are stored as JPEG data URL strings.",
      ),
    label: z
      .string()
      .optional()
      .describe("Label text displayed above the camera input."),
    facingMode: z
      .enum(["user", "environment"])
      .optional()
      .default("environment")
      .describe(
        'Preferred camera direction: "user" (front) or "environment" (rear).',
      ),
  })
  .extend(UNIVERSAL_PROPS.shape);

type CameraInputProps = z.infer<typeof cameraInputProps>;

// -------------------------------------------------------------------- component
function CameraInput({ element }: ComponentRenderProps<CameraInputProps>) {
  const { param, label, facingMode } = element.props;
  const style = (element.props as { style?: string }).style;

  // Form-ready param binding: identical API to useFusedParam, defers broadcast
  // inside a Form, behaves as useFusedParam outside one. debounceMs 0 — a capture
  // is a deliberate single action, no need to debounce. broadcastDefaultValue
  // false — never seed an empty data URL onto the canvas.
  const { value, setValue } = useFusedParamWithForm<string>({
    param,
    defaultValue: "",
    broadcastDefaultValue: false,
    debounceMs: 0,
  });

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const id = `ofw-camera-${param ?? "local"}`;
  const resolvedFacing = facingMode ?? "environment";

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const startCamera = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not available in this browser.");
      return;
    }
    try {
      setError(null);
      stopStream();
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: resolvedFacing },
        audio: false,
      });
      streamRef.current = nextStream;
      setStream(nextStream);
    } catch {
      setError("Could not access camera.");
    }
  }, [resolvedFacing, stopStream]);

  const capturePhoto = React.useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.drawImage(video, 0, 0, width, height);
    // toDataURL throws on a tainted (cross-origin) canvas — not expected for a
    // getUserMedia frame, but guard so a press can never throw uncaught.
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/jpeg");
    } catch {
      setError("Could not capture photo.");
      return;
    }
    setValue(dataUrl);
    stopStream();
  }, [setValue, stopStream]);

  const handleRetake = React.useCallback(() => {
    setValue("");
    void startCamera();
  }, [setValue, startCamera]);

  // Attach the live stream to the preview <video> whenever it changes.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {
      setError("Could not start camera preview.");
    });
  }, [stream]);

  // Always stop the media stream on unmount.
  React.useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return (
    <Field label={label} htmlFor={id} style={parseStyle(style)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            position: "relative",
            width: "100%",
            minHeight: 120,
            borderRadius: 8,
            overflow: "hidden",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {value ? (
            <img
              src={value}
              alt={label ?? "Captured photo"}
              style={{ width: "100%", maxHeight: 280, objectFit: "contain" }}
            />
          ) : stream ? (
            <video
              id={id}
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: "100%", maxHeight: 280, objectFit: "contain" }}
            />
          ) : (
            <span
              style={{ color: "#888", fontSize: 13, padding: 24 }}
              aria-hidden="true"
            >
              No photo captured
            </span>
          )}
        </div>

        {error ? (
          <div className="ofw-error-msg" role="alert">
            {error}
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {stream ? (
            <button
              type="button"
              className="ofw-btn ofw-btn--primary"
              onClick={capturePhoto}
            >
              Capture
            </button>
          ) : value ? (
            <button type="button" className="ofw-btn" onClick={handleRetake}>
              Retake
            </button>
          ) : (
            <button
              type="button"
              className="ofw-btn ofw-btn--primary"
              onClick={() => void startCamera()}
            >
              Start camera
            </button>
          )}
        </div>

        {/* Off-screen capture target; never displayed. */}
        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>
    </Field>
  );
}

const definition: ComponentDef = {
  ...defineComponent({
    component: CameraInput,
    props: cameraInputProps,
    description:
      "Camera input that captures a photo as a JPEG data URL and syncs it to a param.",
    hasChildren: false,
  }),
  writesParam: true,
};

export default definition;
