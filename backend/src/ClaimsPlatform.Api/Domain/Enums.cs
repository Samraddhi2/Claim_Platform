namespace ClaimsPlatform.Api.Domain;

public enum UserRole { Claimant = 0, Officer = 1, Manager = 2 }

public enum ClaimType { Motor = 0, Property = 1 }

public enum Market { SG = 0, HK = 1, TH = 2, MY = 3, ID = 4, AU = 5 }

public enum ClaimStatus
{
    Submitted = 0,      // waiting in the queue
    UnderReview = 1,    // picked up by an officer
    InfoRequested = 2,  // ball is in the claimant's court
    Assessed = 3,       // officer has put a value on it
    Approved = 4,       // decision: pay
    Rejected = 5,       // decision: don't pay (terminal)
    Settled = 6,        // paid out (terminal)
    Withdrawn = 7       // claimant withdrew (terminal)
}
