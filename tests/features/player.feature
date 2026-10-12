Feature: Radio player
  The page shows what is on air and plays the station's stream.

  Background:
    Given the station is playing "Cheryl Lynn - Got to Be Real"

  @smoke
  Scenario: The track on air is shown with its details
    When Alice opens the player
    Then Alice sees the artist "Cheryl Lynn"
    And Alice sees the title "Got to Be Real (1978)"
    And Alice sees the album "Test Pressing"
    And Alice sees the cover art
    And Alice sees the source quality "16-bit 44.1kHz"
    And Alice sees the stream quality "48kHz FLAC / HLS Lossless"

  Scenario: The player is ready to play once the stream has loaded
    When Alice opens the player
    Then the player status is "Ready" for Alice
    And Alice can press play

  @smoke
  Scenario: Playing and pausing the stream
    Given Alice has opened the player
    When Alice presses play
    Then the player status is "Live" for Alice
    And Alice can press pause
    When Alice presses pause
    Then the player status is "Paused" for Alice
    And Alice can press play

  Scenario: Muting and unmuting
    Given Alice has opened the player
    When Alice presses the mute button
    Then the player is muted for Alice
    When Alice presses the mute button
    Then the player is not muted for Alice

  Scenario: Changing the volume
    Given Alice has opened the player
    When Alice sets the volume to 30%
    Then the volume is 30% for Alice

  Scenario: Moving the volume slider unmutes the player
    Given Alice has muted the player
    When Alice sets the volume to 50%
    Then the player is not muted for Alice
    And the volume is 50% for Alice

  Scenario: The track details change when a new song starts
    Given Alice has opened the player
    When the station starts playing "Chic - Le Freak"
    Then Alice sees the artist "Chic"
    And Alice sees the title "Le Freak (1978)"

  @live
  Scenario: The real station is on air
    When Alice opens the player
    Then Alice sees a track on air
    And Alice sees at least one previous track
    And Alice can press play

  @live
  Scenario: The real stream plays
    Given Alice has opened the player
    When Alice presses play
    Then the player status is "Live" for Alice
