"use client";

import { useState } from "react";

interface WakeWordSettingsProps {
  farmId: string;
  currentWakeWord?: string;
  currentEnabled?: boolean;
  onSave: (settings: { wakeWord: string; wakeWordEnabled: boolean }) => void;
  onClose: () => void;
}

const PRESET_WAKE_WORDS = [
  { label: "Hey FarmMind", value: "hey farmmind" },
  { label: "OK Farm", value: "ok farm" },
  { label: "Hey Farm", value: "hey farm" },
];

export default function WakeWordSettings({
  currentWakeWord = "hey farmmind",
  currentEnabled = false,
  onSave,
  onClose,
}: WakeWordSettingsProps) {
  const [wakeWord, setWakeWord] = useState(currentWakeWord);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(currentEnabled);
  const [customMode, setCustomMode] = useState(
    !PRESET_WAKE_WORDS.some((preset) => preset.value === currentWakeWord),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handlePresetClick = (value: string) => {
    setWakeWord(value);
    setCustomMode(false);
    setError(null);
  };

  const handleCustomClick = () => {
    setCustomMode(true);
    setError(null);
  };

  const handleWakeWordChange = (value: string) => {
    setWakeWord(value.toLowerCase());
    setError(null);
  };

  const validateWakeWord = (value: string): string | null => {
    if (!value || value.trim().length === 0) {
      return "Wake word cannot be empty";
    }
    if (value.length < 2) {
      return "Wake word must be at least 2 characters";
    }
    if (value.length > 50) {
      return "Wake word must be at most 50 characters";
    }
    if (!/^[a-zA-Z\s]+$/.test(value)) {
      return "Wake word can only contain letters and spaces";
    }
    return null;
  };

  const handleSave = async () => {
    const validationError = validateWakeWord(wakeWord);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({ wakeWord: wakeWord.trim(), wakeWordEnabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
      setIsSaving(false);
    }
  };

  return (
    <div className="wake-word-settings">
      <div className="settings-header">
        <h2>Voice Wake Word Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="close-button"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="settings-content">
        {/* Enable/Disable Toggle */}
        <div className="setting-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={wakeWordEnabled}
              onChange={(e) => setWakeWordEnabled(e.target.checked)}
              className="toggle-input"
            />
            <span className="toggle-text">
              Enable Wake Word (hands-free mode)
            </span>
          </label>
          <p className="setting-description">
            When enabled, FarmMind listens continuously and activates when it
            hears your wake word.
          </p>
        </div>

        {/* Wake Word Selection */}
        <div className="setting-group">
          <label className="setting-label">Choose your wake word:</label>

          {/* Preset Options */}
          <div className="preset-buttons">
            {PRESET_WAKE_WORDS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => handlePresetClick(preset.value)}
                className={`preset-button ${!customMode && wakeWord === preset.value ? "active" : ""}`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleCustomClick}
              className={`preset-button ${customMode ? "active" : ""}`}
            >
              Custom...
            </button>
          </div>

          {/* Custom Input */}
          {customMode && (
            <div className="custom-input-group">
              <input
                type="text"
                value={wakeWord}
                onChange={(e) => handleWakeWordChange(e.target.value)}
                placeholder="Enter custom wake word"
                className="custom-input"
                maxLength={50}
              />
              <p className="input-hint">
                💡 Works best with 2-3 word phrases (e.g., &quot;Hey
                Buddy&quot;)
              </p>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="setting-group preview-group">
          <label className="setting-label">Preview:</label>
          <div className="preview-box">
            <span className="preview-label">You&apos;ll say:</span>
            <span className="preview-text">
              &quot;{wakeWord} I weeded the field&quot;
            </span>
          </div>
        </div>

        {/* Error Message */}
        {error && <div className="error-message">{error}</div>}

        {/* Action Buttons */}
        <div className="action-buttons">
          <button
            type="button"
            onClick={onClose}
            className="cancel-button"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="save-button"
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      <style jsx>{`
        .wake-word-settings {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 90%;
          max-width: 500px;
          max-height: 90vh;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid #e5e7eb;
        }

        .settings-header h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          color: #111827;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 32px;
          color: #6b7280;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .close-button:hover {
          color: #111827;
        }

        .settings-content {
          padding: 24px;
          overflow-y: auto;
          flex: 1;
        }

        .setting-group {
          margin-bottom: 24px;
        }

        .toggle-label {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
        }

        .toggle-input {
          width: 48px;
          height: 28px;
          cursor: pointer;
        }

        .toggle-text {
          font-size: 16px;
          font-weight: 500;
          color: #111827;
        }

        .setting-description {
          margin: 8px 0 0 0;
          font-size: 14px;
          color: #6b7280;
          line-height: 1.5;
        }

        .setting-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
          margin-bottom: 12px;
        }

        .preset-buttons {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }

        .preset-button {
          padding: 12px 16px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          background: white;
          color: #374151;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .preset-button:hover {
          border-color: #3b82f6;
          background: #eff6ff;
        }

        .preset-button.active {
          border-color: #3b82f6;
          background: #3b82f6;
          color: white;
        }

        .custom-input-group {
          margin-top: 12px;
        }

        .custom-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #e5e7eb;
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 0.2s;
        }

        .custom-input:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .input-hint {
          margin: 8px 0 0 0;
          font-size: 13px;
          color: #6b7280;
        }

        .preview-group {
          background: #f9fafb;
          padding: 16px;
          border-radius: 8px;
        }

        .preview-box {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .preview-label {
          font-size: 13px;
          color: #6b7280;
          font-weight: 500;
        }

        .preview-text {
          font-size: 16px;
          color: #111827;
          font-style: italic;
        }

        .error-message {
          padding: 12px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          color: #dc2626;
          font-size: 14px;
          margin-bottom: 16px;
        }

        .action-buttons {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          padding-top: 16px;
          border-top: 1px solid #e5e7eb;
        }

        .cancel-button,
        .save-button {
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .cancel-button {
          background: white;
          color: #374151;
          border: 1px solid #d1d5db;
        }

        .cancel-button:hover:not(:disabled) {
          background: #f9fafb;
        }

        .save-button {
          background: #3b82f6;
          color: white;
        }

        .save-button:hover:not(:disabled) {
          background: #2563eb;
        }

        .cancel-button:disabled,
        .save-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 640px) {
          .wake-word-settings {
            width: 100%;
            max-width: 100%;
            height: 100%;
            max-height: 100%;
            border-radius: 0;
          }

          .preset-buttons {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
