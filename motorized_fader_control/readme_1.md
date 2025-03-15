flowchart TD
    A["UIConfig"] -- Saves Config --> B["ConfigManager"]
    B -- Config Data --> C["ServiceRouter"]
    C -- Routes to --> D["VolumeService"] & E["SeekService"] & F["AlbumService"]
    G["FaderController"] -- Raw Events --> H["FaderAdapter"]
    H -- Normalized Events --> I["EventBus"]
    I -- Volume Events --> D
    I -- Seek Events --> E
    I -- Album Events --> F
    D -- State Updates --> J["StateCache"]
    E -- State Updates --> J
    F -- State Updates --> J
    J -- Cached Data --> K["VolumioBridge"]
    K -- WebSocket --> L["Volumio Core"]
    L -- Push Updates --> K
    K -- State Changes --> I
    I -- Position Updates --> H
    H -- Moves Faders --> G

    style A fill:#8f8,stroke:#333
    style G fill:#f9f,stroke:#333


