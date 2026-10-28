using ClaimsPlatform.Api.Domain;
using Xunit;

namespace ClaimsPlatform.Tests;

/// <summary>
/// Exhaustive checks of the claim lifecycle. <see cref="ClaimStateMachineTests"/> spot-checks a few transitions;
/// these tests pin down EVERY (from, to) pair and EVERY (persona, status) combination so a change to the rules
/// cannot slip through unnoticed.
/// </summary>
public class ClaimStateMachineMatrixTests
{
    // ───────────── the lifecycle graph, written out independently of the implementation ─────────────

    private static readonly (ClaimStatus From, ClaimStatus To)[] ExpectedEdges =
    {
        (ClaimStatus.Submitted,     ClaimStatus.UnderReview),
        (ClaimStatus.Submitted,     ClaimStatus.Withdrawn),
        (ClaimStatus.UnderReview,   ClaimStatus.InfoRequested),
        (ClaimStatus.UnderReview,   ClaimStatus.Assessed),
        (ClaimStatus.UnderReview,   ClaimStatus.Rejected),
        (ClaimStatus.UnderReview,   ClaimStatus.Withdrawn),
        (ClaimStatus.InfoRequested, ClaimStatus.UnderReview),
        (ClaimStatus.InfoRequested, ClaimStatus.Withdrawn),
        (ClaimStatus.Assessed,      ClaimStatus.Approved),
        (ClaimStatus.Assessed,      ClaimStatus.Rejected),
        (ClaimStatus.Assessed,      ClaimStatus.UnderReview),
        (ClaimStatus.Approved,      ClaimStatus.Settled),
    };

    private static readonly ClaimStatus[] All = Enum.GetValues<ClaimStatus>();
    private static readonly ClaimStatus[] Terminal = { ClaimStatus.Rejected, ClaimStatus.Settled, ClaimStatus.Withdrawn };

    public static IEnumerable<object[]> AllPairs()
    {
        foreach (var from in All)
            foreach (var to in All)
                yield return new object[] { from, to };
    }

    [Theory]
    [MemberData(nameof(AllPairs))]
    public void Every_status_pair_matches_the_documented_lifecycle(ClaimStatus from, ClaimStatus to)
    {
        var expected = ExpectedEdges.Contains((from, to));
        Assert.Equal(expected, ClaimStateMachine.CanTransition(from, to));
    }

    [Fact]
    public void The_lifecycle_has_exactly_twelve_legal_transitions()
    {
        var legal = All.SelectMany(f => All.Select(t => (f, t))).Count(p => ClaimStateMachine.CanTransition(p.f, p.t));
        Assert.Equal(12, legal);
        Assert.Equal(ExpectedEdges.Length, legal);
    }

    [Fact]
    public void A_status_can_never_transition_to_itself()
    {
        foreach (var s in All) Assert.False(ClaimStateMachine.CanTransition(s, s), $"{s} -> {s}");
    }

    [Fact]
    public void Terminal_statuses_have_no_way_out()
    {
        foreach (var from in Terminal)
            foreach (var to in All)
                Assert.False(ClaimStateMachine.CanTransition(from, to), $"{from} -> {to}");
    }

    [Fact]
    public void Every_open_status_can_still_make_progress()
    {
        foreach (var s in ClaimStateMachine.OpenStatuses)
            Assert.True(All.Any(t => ClaimStateMachine.CanTransition(s, t)), $"{s} is a dead end");
    }

    [Fact]
    public void Every_status_is_reachable_from_Submitted()
    {
        var seen = new HashSet<ClaimStatus> { ClaimStatus.Submitted };
        var queue = new Queue<ClaimStatus>(seen);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var next in All.Where(t => ClaimStateMachine.CanTransition(current, t)))
                if (seen.Add(next)) queue.Enqueue(next);
        }
        Assert.Equal(All.Length, seen.Count);
    }

    [Fact]
    public void Every_open_status_can_eventually_reach_a_terminal_status()
    {
        foreach (var start in ClaimStateMachine.OpenStatuses)
        {
            var seen = new HashSet<ClaimStatus> { start };
            var queue = new Queue<ClaimStatus>(seen);
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                foreach (var next in All.Where(t => ClaimStateMachine.CanTransition(current, t)))
                    if (seen.Add(next)) queue.Enqueue(next);
            }
            Assert.True(seen.Overlaps(Terminal), $"{start} can never finish");
        }
    }

    [Fact]
    public void An_approved_claim_can_only_be_settled_it_cannot_be_withdrawn_or_rejected()
    {
        Assert.True(ClaimStateMachine.CanTransition(ClaimStatus.Approved, ClaimStatus.Settled));
        Assert.False(ClaimStateMachine.CanTransition(ClaimStatus.Approved, ClaimStatus.Withdrawn));
        Assert.False(ClaimStateMachine.CanTransition(ClaimStatus.Approved, ClaimStatus.Rejected));
        Assert.False(ClaimStateMachine.CanTransition(ClaimStatus.Approved, ClaimStatus.UnderReview));
    }

    [Fact]
    public void A_claimant_cannot_withdraw_once_assessment_has_started()
    {
        Assert.False(ClaimStateMachine.CanTransition(ClaimStatus.Assessed, ClaimStatus.Withdrawn));
        Assert.False(ClaimStateMachine.CanTransition(ClaimStatus.Approved, ClaimStatus.Withdrawn));
    }

    [Fact]
    public void EnsureTransition_accepts_every_legal_edge_silently()
    {
        foreach (var (from, to) in ExpectedEdges)
            ClaimStateMachine.EnsureTransition(from, to); // must not throw
    }

    [Fact]
    public void EnsureTransition_rejects_every_illegal_pair_with_a_409_that_names_both_statuses()
    {
        foreach (var from in All)
        {
            foreach (var to in All.Where(t => !ExpectedEdges.Contains((from, t))))
            {
                var ex = Assert.Throws<DomainException>(() => ClaimStateMachine.EnsureTransition(from, to));
                Assert.Equal(409, ex.StatusCode);
                Assert.Contains($"'{from}'", ex.Message);
                Assert.Contains($"'{to}'", ex.Message);
            }
        }
    }

    // ───────────── open vs closed ─────────────

    [Fact]
    public void Open_statuses_are_exactly_the_five_in_flight_ones()
    {
        var open = All.Where(ClaimStateMachine.IsOpen).OrderBy(s => (int)s).ToArray();
        Assert.Equal(
            new[] { ClaimStatus.Submitted, ClaimStatus.UnderReview, ClaimStatus.InfoRequested, ClaimStatus.Assessed, ClaimStatus.Approved },
            open);
        Assert.Equal(5, ClaimStateMachine.OpenStatuses.Distinct().Count());
    }

    [Fact]
    public void Approved_still_counts_as_open_because_money_has_not_left_yet()
    {
        Assert.True(ClaimStateMachine.IsOpen(ClaimStatus.Approved));
    }

    [Fact]
    public void The_four_eyes_threshold_is_fifty_thousand()
    {
        Assert.Equal(50_000m, ClaimStateMachine.ManagerApprovalThreshold);
    }

    // ───────────── who may do what: every persona x every status ─────────────

    private const int ClaimantId = 1, OtherClaimantId = 2, AssigneeId = 10, OtherOfficerId = 11, ManagerId = 99;

    private static AppUser UserFor(string persona) => persona switch
    {
        "owner"          => new AppUser { Id = ClaimantId, Role = UserRole.Claimant },
        "other-claimant" => new AppUser { Id = OtherClaimantId, Role = UserRole.Claimant },
        "assignee"       => new AppUser { Id = AssigneeId, Role = UserRole.Officer },
        "other-officer"  => new AppUser { Id = OtherOfficerId, Role = UserRole.Officer },
        "manager"        => new AppUser { Id = ManagerId, Role = UserRole.Manager },
        _ => throw new ArgumentException(persona),
    };

    private static Claim ClaimIn(ClaimStatus status) =>
        new() { Id = 1, Status = status, ClaimantId = ClaimantId, AssignedOfficerId = AssigneeId };

    private static string Actions(string persona, ClaimStatus status) =>
        string.Join(",", ClaimStateMachine.AvailableActions(ClaimIn(status), UserFor(persona)).OrderBy(a => a, StringComparer.Ordinal));

    /// <summary>The permission table, spelled out. Each row: persona, status, comma-separated actions (sorted).</summary>
    private static readonly (string Persona, ClaimStatus Status, string Expected)[] Permissions =
    {
        // the claimant who filed it
        ("owner", ClaimStatus.Submitted,     "withdraw"),
        ("owner", ClaimStatus.UnderReview,   "withdraw"),
        ("owner", ClaimStatus.InfoRequested, "provideInfo,withdraw"),
        ("owner", ClaimStatus.Assessed,      ""),
        ("owner", ClaimStatus.Approved,      ""),
        ("owner", ClaimStatus.Rejected,      ""),
        ("owner", ClaimStatus.Settled,       ""),
        ("owner", ClaimStatus.Withdrawn,     ""),
        // some other claimant: nothing, ever
        ("other-claimant", ClaimStatus.Submitted,     ""),
        ("other-claimant", ClaimStatus.UnderReview,   ""),
        ("other-claimant", ClaimStatus.InfoRequested, ""),
        ("other-claimant", ClaimStatus.Assessed,      ""),
        ("other-claimant", ClaimStatus.Approved,      ""),
        ("other-claimant", ClaimStatus.Rejected,      ""),
        ("other-claimant", ClaimStatus.Settled,       ""),
        ("other-claimant", ClaimStatus.Withdrawn,     ""),
        // the officer the claim is assigned to
        ("assignee", ClaimStatus.Submitted,     "addNote,assignToMe"),
        ("assignee", ClaimStatus.UnderReview,   "addNote,assess,reject,requestInfo"),
        ("assignee", ClaimStatus.InfoRequested, "addNote"),
        ("assignee", ClaimStatus.Assessed,      "addNote,approve,reject,reopen"),
        ("assignee", ClaimStatus.Approved,      "addNote,settle"),
        ("assignee", ClaimStatus.Rejected,      ""),
        ("assignee", ClaimStatus.Settled,       ""),
        ("assignee", ClaimStatus.Withdrawn,     ""),
        // an officer who does NOT own it: may only pick it up from the queue or leave a note
        ("other-officer", ClaimStatus.Submitted,     "addNote,assignToMe"),
        ("other-officer", ClaimStatus.UnderReview,   "addNote"),
        ("other-officer", ClaimStatus.InfoRequested, "addNote"),
        ("other-officer", ClaimStatus.Assessed,      "addNote"),
        ("other-officer", ClaimStatus.Approved,      "addNote"),
        ("other-officer", ClaimStatus.Rejected,      ""),
        ("other-officer", ClaimStatus.Settled,       ""),
        ("other-officer", ClaimStatus.Withdrawn,     ""),
        // a manager: can work any claim and (re)assign anything that is not yet approved
        ("manager", ClaimStatus.Submitted,     "addNote,assign,assignToMe"),
        ("manager", ClaimStatus.UnderReview,   "addNote,assess,assign,reject,requestInfo"),
        ("manager", ClaimStatus.InfoRequested, "addNote,assign"),
        ("manager", ClaimStatus.Assessed,      "addNote,approve,assign,reject,reopen"),
        ("manager", ClaimStatus.Approved,      "addNote,settle"),
        ("manager", ClaimStatus.Rejected,      ""),
        ("manager", ClaimStatus.Settled,       ""),
        ("manager", ClaimStatus.Withdrawn,     ""),
    };

    public static IEnumerable<object[]> PermissionRows() =>
        Permissions.Select(p => new object[] { p.Persona, p.Status, p.Expected });

    [Theory]
    [MemberData(nameof(PermissionRows))]
    public void Available_actions_follow_the_permission_table(string persona, ClaimStatus status, string expected)
    {
        Assert.Equal(expected, Actions(persona, status));
    }

    [Fact]
    public void The_permission_table_covers_every_persona_and_status()
    {
        Assert.Equal(5 * All.Length, Permissions.Length);
        Assert.Equal(Permissions.Length, Permissions.Select(p => (p.Persona, p.Status)).Distinct().Count());
    }

    [Fact]
    public void Nobody_is_offered_any_action_on_a_closed_claim()
    {
        foreach (var persona in new[] { "owner", "other-claimant", "assignee", "other-officer", "manager" })
            foreach (var status in Terminal)
                Assert.Equal("", Actions(persona, status));
    }

    [Fact]
    public void Every_status_changing_action_offered_to_the_UI_is_a_legal_transition()
    {
        // The UI draws buttons from AvailableActions; if it ever offers something the state machine would
        // reject, users would click into a 409. This ties the two together.
        var target = new Dictionary<string, ClaimStatus>
        {
            ["withdraw"] = ClaimStatus.Withdrawn,
            ["provideInfo"] = ClaimStatus.UnderReview,
            ["assignToMe"] = ClaimStatus.UnderReview,
            ["requestInfo"] = ClaimStatus.InfoRequested,
            ["assess"] = ClaimStatus.Assessed,
            ["approve"] = ClaimStatus.Approved,
            ["reject"] = ClaimStatus.Rejected,
            ["reopen"] = ClaimStatus.UnderReview,
            ["settle"] = ClaimStatus.Settled,
        };

        foreach (var persona in new[] { "owner", "other-claimant", "assignee", "other-officer", "manager" })
            foreach (var status in All)
                foreach (var action in ClaimStateMachine.AvailableActions(ClaimIn(status), UserFor(persona)))
                {
                    if (!target.TryGetValue(action, out var to)) continue; // addNote / assign don't change status
                    Assert.True(ClaimStateMachine.CanTransition(status, to), $"{persona} is offered '{action}' on a {status} claim");
                }
    }

    [Fact]
    public void Only_a_manager_is_ever_offered_assign()
    {
        foreach (var persona in new[] { "owner", "other-claimant", "assignee", "other-officer" })
            foreach (var status in All)
                Assert.DoesNotContain("assign", ClaimStateMachine.AvailableActions(ClaimIn(status), UserFor(persona)));
    }

    [Fact]
    public void An_unassigned_claim_gives_no_officer_decision_rights_but_a_manager_keeps_them()
    {
        var claim = new Claim { Id = 1, Status = ClaimStatus.Assessed, ClaimantId = ClaimantId, AssignedOfficerId = null };
        Assert.Equal("addNote", string.Join(",", ClaimStateMachine.AvailableActions(claim, UserFor("other-officer"))));
        Assert.Contains("approve", ClaimStateMachine.AvailableActions(claim, UserFor("manager")));
    }
}
