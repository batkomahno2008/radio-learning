Feature: Ratings in the listening history
  Every previous track has its own thumbs and totals, and a rating
  stays with its track when a new song pushes it down the list.

  Background:
    Given the station is playing "Cheryl Lynn - Got to Be Real"
    And the previous tracks are:
      | Faith No More - We Care a Lot       |
      | Grace Jones - Pull Up To The Bumper |
      | The Hollies - Long Cool Woman       |

  @smoke
  Scenario: Every previous track is listed with its own rating
    When Alice opens the player
    Then Alice sees these previous tracks:
      | Faith No More: We Care a Lot       |
      | Grace Jones: Pull Up To The Bumper |
      | The Hollies: Long Cool Woman       |
    And Alice can rate every previous track
    And Alice sees 0 up and 0 down for "Grace Jones - Pull Up To The Bumper" in the history

  Scenario: Rating a previous track leaves the other tracks untouched
    When Alice gives "Faith No More - We Care a Lot" in the history a thumbs down
    Then Alice sees 0 up and 1 down for "Faith No More - We Care a Lot" in the history
    And Alice's thumbs down is selected for "Faith No More - We Care a Lot" in the history
    And Alice sees 0 up and 0 down for "Grace Jones - Pull Up To The Bumper" in the history
    And Alice sees 0 up and 0 down for "The Hollies - Long Cool Woman" in the history
    And Alice sees 0 up and 0 down for the current track

  Scenario: Switching and clearing a rating on a previous track
    Given Alice has given "Grace Jones - Pull Up To The Bumper" in the history a thumbs up
    When Alice gives "Grace Jones - Pull Up To The Bumper" in the history a thumbs down
    Then Alice sees 0 up and 1 down for "Grace Jones - Pull Up To The Bumper" in the history
    When Alice presses the thumbs down for "Grace Jones - Pull Up To The Bumper" in the history again
    Then Alice sees 0 up and 0 down for "Grace Jones - Pull Up To The Bumper" in the history
    And Alice has no thumb selected for "Grace Jones - Pull Up To The Bumper" in the history

  Scenario: Another listener's vote on a previous track appears without a reload
    Given Alice has given "Faith No More - We Care a Lot" in the history a thumbs down
    And Bob has given "Faith No More - We Care a Lot" in the history a thumbs up
    When Alice's player checks the station again
    Then Alice sees 1 up and 1 down for "Faith No More - We Care a Lot" in the history
    And Alice's thumbs down is selected for "Faith No More - We Care a Lot" in the history

  Scenario: A rating follows its track into the history
    Given Alice has given the current track a thumbs up
    When the station starts playing "Chic - Le Freak"
    Then Alice sees 0 up and 0 down for the current track
    And Alice has no thumb selected for the current track
    And Alice sees 1 up and 0 down for "Cheryl Lynn - Got to Be Real" in the history
    And Alice's thumbs up is selected for "Cheryl Lynn - Got to Be Real" in the history

  Scenario: A new song moves the earlier tracks down with their ratings
    Given Alice has given "Faith No More - We Care a Lot" in the history a thumbs down
    When the station starts playing "Chic - Le Freak"
    Then Alice sees these previous tracks:
      | Cheryl Lynn: Got to Be Real        |
      | Faith No More: We Care a Lot       |
      | Grace Jones: Pull Up To The Bumper |
      | The Hollies: Long Cool Woman       |
    And Alice sees 0 up and 1 down for "Faith No More - We Care a Lot" in the history
    And Alice's thumbs down is selected for "Faith No More - We Care a Lot" in the history

  Scenario: A rating can be removed from the history row
    Given Alice has given the current track a thumbs up
    And the station starts playing "Chic - Le Freak"
    When Alice presses the thumbs up for "Cheryl Lynn - Got to Be Real" in the history again
    Then Alice sees 0 up and 0 down for "Cheryl Lynn - Got to Be Real" in the history
    And Alice has no thumb selected for "Cheryl Lynn - Got to Be Real" in the history

  Scenario: A previous track without an artist cannot be rated
    Given the previous tracks are:
      | Faith No More - We Care a Lot |
      | Station Ident                 |
    When Alice opens the player
    Then Alice cannot rate "Unknown artist: Station Ident"
    And Alice sees 0 up and 0 down for "Faith No More - We Care a Lot" in the history
