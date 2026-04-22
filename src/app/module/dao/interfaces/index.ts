export interface TeamMember {
    teamMemberWallet: string;
    teamMemberRole: string;
    quantity?: string;
    issueDaoToken: boolean;
}

export interface Founder {
    founderWalletAlias: string;
    founderWalletAddress: string;
    initialAllocation: string;
    issueDaoToken: boolean;
}

export interface WhitelistedAccount {
    whitelisted: string;
    whitelistedRS: string;
}
