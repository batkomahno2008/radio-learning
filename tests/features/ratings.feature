Feature: Track ratings
  Listeners rate the track on air with a thumbs up or a thumbs down
  and see the totals from everyone who has rated it.

  Background:
    Given the station is playing "Cheryl Lynn - Got to Be Real"
    And the previous tracks are:
      | Faith No More - We Care a Lot       |
      | Grace Jones - Pull Up To The Bumper |
      | The Hollies - Long Cool Woman       |

  @smoke
  Scenario: A track nobody has rated shows zero totals
    When Alice opens the player
    Then Alice sees 0 up and 0 down for the current track
    And Alice has no thumb selected for the current track

  @smoke
  Scenario: Giving a thumbs up
    When Alice gives the current track a thumbs up
    Then Alice sees 1 up and 0 down for the current track
    And Alice's thumbs up is selected for the current track

  Scenario: Giving a thumbs down
    When Alice gives the current track a thumbs down
    Then Alice sees 0 up and 1 down for the current track
    And Alice's thumbs down is selected for the current track

  Scenario: Switching thumbs moves the vote instead of adding one
    Given Alice has given the current track a thumbs up
    When Alice gives the current track a thumbs down
    Then Alice sees 0 up and 1 down for the current track
    And Alice's thumbs down is selected for the current track

  Scenario: Pressing the selected thumb again clears the rating
    Given Alice has given the current track a thumbs up
    When Alice presses the thumbs up for the current track again
    Then Alice sees 0 up and 0 down for the current track
    And Alice has no thumb selected for the current track

  Scenario: Another listener sees the total but not the selection
    Given Alice has given the current track a thumbs up
    When Bob opens the player
    Then Bob sees 1 up and 0 down for the current track
    And Bob has no thumb selected for the current track

  Scenario: Totals add up across listeners
    Given Alice has given the current track a thumbs up
    When Bob gives the current track a thumbs up
    Then Bob sees 2 up and 0 down for the current track
    And Bob's thumbs up is selected for the current track
    And the ratings API reports 2 up and 0 down for "Cheryl Lynn - Got to Be Real"

  Scenario: Votes from another listener appear without a reload
    Given Alice has given the current track a thumbs up
    And Bob has given the current track a thumbs down
    When Alice's player checks the station again
    Then Alice sees 1 up and 1 down for the current track
    And Alice's thumbs up is selected for the current track

  Scenario: Ratings and selections survive a reload
    Given Alice has given the current track a thumbs up
    And Alice has given "Faith No More - We Care a Lot" in the history a thumbs down
    When Alice reloads the page
    Then Alice sees 1 up and 0 down for the current track
    And Alice's thumbs up is selected for the current track
    And Alice sees 0 up and 1 down for "Faith No More - We Care a Lot" in the history
    And Alice's thumbs down is selected for "Faith No More - We Care a Lot" in the history
