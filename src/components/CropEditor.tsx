import React, { useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { colors, radius, spacing } from '@/theme';
import type { CropRect } from '@/lib/images';

const HANDLE = 30;
const MIN_SIZE = 48;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Grab = 'move' | 'tl' | 'tr' | 'bl' | 'br' | null;

/**
 * Rectangular crop with four draggable corners plus whole-frame drag.
 *
 * Built on PanResponder rather than a gesture library on purpose: it is the
 * platform primitive, has no worklet/threading caveats, and the maths here is
 * simple enough that predictability beats fluidity.
 */
export function CropEditor({
  uri,
  imageWidth,
  imageHeight,
  onCropChange,
}: {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  onCropChange: (crop: CropRect | null) => void;
}) {
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [rect, setRect] = useState<Rect | null>(null);

  // Refs keep the responder callbacks reading live values without re-creating
  // the responder on every render.
  const rectRef = useRef<Rect | null>(null);
  const startRect = useRef<Rect | null>(null);
  const grab = useRef<Grab>(null);

  const display = useMemo(() => {
    if (!container.width || !container.height || !imageWidth || !imageHeight) return null;
    const scale = Math.min(container.width / imageWidth, container.height / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      width,
      height,
      left: (container.width - width) / 2,
      top: (container.height - height) / 2,
      scale,
    };
  }, [container, imageWidth, imageHeight]);

  const displayRef = useRef(display);
  displayRef.current = display;

  // Initialise (or reset when the image changes) to the full frame.
  const initialisedFor = useRef<string>('');
  if (display && initialisedFor.current !== `${uri}:${display.width}x${display.height}`) {
    initialisedFor.current = `${uri}:${display.width}x${display.height}`;
    const full = { x: 0, y: 0, w: display.width, h: display.height };
    rectRef.current = full;
    // setState during render is safe here (same-component, guarded by the ref)
    // and avoids a frame where the overlay is missing.
    setRect(full);
  }

  const emit = (next: Rect) => {
    const d = displayRef.current;
    if (!d) return;
    const isFull =
      next.x <= 0.5 && next.y <= 0.5 && next.w >= d.width - 0.5 && next.h >= d.height - 0.5;
    onCropChange(
      isFull
        ? null
        : {
            originX: next.x / d.scale,
            originY: next.y / d.scale,
            width: next.w / d.scale,
            height: next.h / d.scale,
          },
    );
  };

  const hitTest = (localX: number, localY: number, r: Rect): Grab => {
    const near = (px: number, py: number) =>
      Math.abs(localX - px) <= HANDLE && Math.abs(localY - py) <= HANDLE;
    if (near(r.x, r.y)) return 'tl';
    if (near(r.x + r.w, r.y)) return 'tr';
    if (near(r.x, r.y + r.h)) return 'bl';
    if (near(r.x + r.w, r.y + r.h)) return 'br';
    if (localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h) return 'move';
    return null;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const d = displayRef.current;
        const r = rectRef.current;
        if (!d || !r) return;
        const localX = event.nativeEvent.locationX - d.left;
        const localY = event.nativeEvent.locationY - d.top;
        grab.current = hitTest(localX, localY, r);
        startRect.current = { ...r };
      },
      onPanResponderMove: (_event, gesture: PanResponderGestureState) => {
        const d = displayRef.current;
        const start = startRect.current;
        if (!d || !start || !grab.current) return;

        const dx = gesture.dx;
        const dy = gesture.dy;
        let next: Rect;

        if (grab.current === 'move') {
          next = {
            x: clamp(start.x + dx, 0, d.width - start.w),
            y: clamp(start.y + dy, 0, d.height - start.h),
            w: start.w,
            h: start.h,
          };
        } else {
          let left = start.x;
          let top = start.y;
          let right = start.x + start.w;
          let bottom = start.y + start.h;

          if (grab.current === 'tl' || grab.current === 'bl') {
            left = clamp(start.x + dx, 0, right - MIN_SIZE);
          } else {
            right = clamp(start.x + start.w + dx, left + MIN_SIZE, d.width);
          }
          if (grab.current === 'tl' || grab.current === 'tr') {
            top = clamp(start.y + dy, 0, bottom - MIN_SIZE);
          } else {
            bottom = clamp(start.y + start.h + dy, top + MIN_SIZE, d.height);
          }
          next = { x: left, y: top, w: right - left, h: bottom - top };
        }

        rectRef.current = next;
        setRect(next);
      },
      onPanResponderRelease: () => {
        grab.current = null;
        if (rectRef.current) emit(rectRef.current);
      },
      onPanResponderTerminate: () => {
        grab.current = null;
        if (rectRef.current) emit(rectRef.current);
      },
    }),
  ).current;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer({ width, height });
  };

  return (
    <View style={styles.container} onLayout={onLayout} {...responder.panHandlers}>
      {display ? (
        <>
          <Image
            source={{ uri }}
            style={{
              position: 'absolute',
              left: display.left,
              top: display.top,
              width: display.width,
              height: display.height,
            }}
            resizeMode="contain"
          />
          {rect ? (
            <>
              {/* Dim everything outside the crop rectangle. */}
              <Shade
                left={display.left}
                top={display.top}
                width={display.width}
                height={rect.y}
              />
              <Shade
                left={display.left}
                top={display.top + rect.y + rect.h}
                width={display.width}
                height={display.height - rect.y - rect.h}
              />
              <Shade
                left={display.left}
                top={display.top + rect.y}
                width={rect.x}
                height={rect.h}
              />
              <Shade
                left={display.left + rect.x + rect.w}
                top={display.top + rect.y}
                width={display.width - rect.x - rect.w}
                height={rect.h}
              />

              <View
                pointerEvents="none"
                style={[
                  styles.frame,
                  {
                    left: display.left + rect.x,
                    top: display.top + rect.y,
                    width: rect.w,
                    height: rect.h,
                  },
                ]}
              >
                <Corner style={{ left: -2, top: -2 }} />
                <Corner style={{ right: -2, top: -2 }} />
                <Corner style={{ left: -2, bottom: -2 }} />
                <Corner style={{ right: -2, bottom: -2 }} />
              </View>
            </>
          ) : null}
        </>
      ) : (
        <Text style={styles.placeholder}>Loading image…</Text>
      )}
    </View>
  );
}

function Shade({
  left,
  top,
  width,
  height,
}: {
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  return <View pointerEvents="none" style={[styles.shade, { left, top, width, height }]} />;
}

function Corner({ style }: { style: object }) {
  return <View style={[styles.corner, style]} />;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.sm,
  },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  placeholder: {
    color: colors.textDim,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
});
