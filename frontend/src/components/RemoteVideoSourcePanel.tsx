import { LoaderCircle, Monitor, MonitorUp, Plus, RectangleHorizontal } from "lucide-react";

import type { RemoteControlPageProps } from "../app/remoteControlPageProps.js";

// 被控端上报的屏类型(pb.Enums):0=物理屏, 1=虚拟屏, 2=超级屏(多屏拼接)。
const SCREEN_TYPE_VIRTUAL = 1;
const SCREEN_TYPE_SUPER = 2;

export function RemoteVideoSourcePanel({
  busy,
  onRemoteScreenSwitch,
  onRemoteVideoSourceChange,
  onCreateVirtualScreen,
  primaryRemoteVideoId,
  remoteVideoSources,
}: Pick<
  RemoteControlPageProps,
  "busy" | "onRemoteScreenSwitch" | "onRemoteVideoSourceChange" | "onCreateVirtualScreen" | "primaryRemoteVideoId" | "remoteVideoSources"
>) {
  const hasSources = remoteVideoSources.length > 0;
  // 只有真实屏幕清单(带 screenId)才支持“切换被控端采集目标”；
  // 退化成按视频轨展示时，点击只是在本地换路视频，不惊动被控端。
  const canSwitchScreens = remoteVideoSources.some((source) => source.screenId !== undefined);

  return (
    <section className="control-insight-panel" aria-label="画面源">
      <header>
        <div>
          <Monitor size={17} />
          <h2>显示器</h2>
        </div>
        <span>{hasSources ? `${remoteVideoSources.length} 台` : "等待画面"}</span>
      </header>
      <p>
        {hasSources
          ? canSwitchScreens
            ? "点选要观看的显示器，被控端会切换采集目标"
            : "选择要显示的画面"
          : "连接后显示被控端的显示器列表"}
      </p>
      <div className="video-source-list">
        {hasSources ? (
          remoteVideoSources.map((source) => {
            const selected = source.isCurrent ?? source.id === primaryRemoteVideoId;
            return (
              <button
                type="button"
                key={source.id}
                className={source.hasSignal ? (selected ? "video-source-current" : undefined) : "video-source-empty"}
                aria-pressed={selected}
                onClick={() => {
                  if (source.screenId !== undefined) onRemoteScreenSwitch(source.screenId);
                  else onRemoteVideoSourceChange(source.id);
                }}
              >
                <span>
                  {readScreenTypeIcon(source.screenType)}
                  {formatSourceLabel(source)}
                </span>
                <small>
                  {[source.resolution || (source.hasSignal ? "画面中" : "无信号"), source.fps ? `${source.fps}fps` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </button>
            );
          })
        ) : (
          <span>暂无画面源</span>
        )}
      </div>
      {canSwitchScreens ? (
        <button
          type="button"
          className="video-source-create"
          onClick={onCreateVirtualScreen}
          disabled={busy !== null}
          title="请求被控端补建一块虚拟显示器，用于扩展桌面"
        >
          {busy === "browser-remote-start" ? <LoaderCircle className="spin" size={15} /> : <MonitorUp size={15} />}
          创建虚拟屏
        </button>
      ) : null}
    </section>
  );
}

function readScreenTypeIcon(screenType: number | undefined) {
  if (screenType === SCREEN_TYPE_VIRTUAL) return <Plus size={13} aria-hidden="true" />;
  if (screenType === SCREEN_TYPE_SUPER) return <RectangleHorizontal size={13} aria-hidden="true" />;
  return null;
}

function formatSourceLabel(source: { screenType?: number; label?: string; index: number }): string {
  if (source.label) return source.label;
  if (source.screenType === SCREEN_TYPE_VIRTUAL) return `虚拟屏 ${source.index + 1}`;
  if (source.screenType === SCREEN_TYPE_SUPER) return `超级屏 ${source.index + 1}`;
  return `显示器 ${source.index + 1}`;
}
